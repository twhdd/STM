from pathlib import Path
import math
import time

from .detector import UltralyticsDetector
from .metrics import VideoMetrics
from .output import build_document, write_json
from .validation import (
    VisionError,
    make_counting_line,
    validate_confidence,
    validate_device,
    validate_options,
    validate_paths,
)


def _load_cv2():
    try:
        import cv2
    except ImportError as error:
        raise VisionError(
            "OpenCV is not installed; install ai-service/requirements.txt"
        ) from error
    return cv2


def _resolve_device(device):
    if device != "auto":
        return int(device) if device.isdigit() else device
    try:
        import torch

        return 0 if torch.cuda.is_available() else "cpu"
    except ImportError as error:
        raise VisionError(
            "PyTorch is unavailable, so the automatic compute device cannot be selected"
        ) from error


def _draw_detections(cv2, frame, detections, counting_line):
    for detection in detections:
        x1, y1, x2, y2 = (int(round(value)) for value in detection.bbox)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (50, 210, 50), 2)
        label = f"{detection.class_name} {detection.confidence:.2f}"
        if detection.track_id is not None:
            label += f" ID:{detection.track_id}"
        cv2.putText(
            frame,
            label,
            (x1, max(18, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (50, 210, 50),
            1,
            cv2.LINE_AA,
        )
    if counting_line is not None:
        start = (round(counting_line["x1"]), round(counting_line["y1"]))
        end = (round(counting_line["x2"]), round(counting_line["y2"]))
        cv2.line(frame, start, end, (0, 220, 255), 2)


def _is_premature_read_failure(capture, cv2, reported_frame_count, frames_processed):
    if reported_frame_count is None:
        return False
    try:
        position = float(capture.get(cv2.CAP_PROP_POS_FRAMES))
        ratio = float(capture.get(cv2.CAP_PROP_POS_AVI_RATIO))
    except (AttributeError, TypeError, ValueError):
        return False
    if not math.isfinite(position) or not math.isfinite(ratio):
        return False

    # Frame count is only a hint: require a substantial gap and a non-EOF
    # stream position before treating a failed read as a decoding error.
    frames_remaining = reported_frame_count - max(position, frames_processed)
    return frames_remaining > 1 and ratio < 0.99


def _read_timestamp_ms(capture, cv2, frame_index):
    try:
        timestamp_ms = float(capture.get(cv2.CAP_PROP_POS_MSEC))
    except (AttributeError, TypeError, ValueError):
        return None
    if not math.isfinite(timestamp_ms) or timestamp_ms < 0:
        return None
    if timestamp_ms == 0 and frame_index > 0:
        try:
            frame_position = float(capture.get(cv2.CAP_PROP_POS_FRAMES))
        except (AttributeError, TypeError, ValueError):
            frame_position = math.nan
        if math.isfinite(frame_position) and frame_position > 1:
            # Some backends report zero when frame timestamps are unavailable.
            # Preserve frame zero, but treat repeated zeroes after confirmed
            # frame progress as unavailable; a genuine zero cannot be excluded.
            return None
    return timestamp_ms


def run_video(
    input_path,
    weights_path,
    output_path,
    annotated_path=None,
    confidence=0.25,
    device="auto",
    tracking=False,
    counting_line_values=None,
    max_track_age_frames=30,
):
    confidence = validate_confidence(float(confidence))
    device = validate_device(device)
    counting_line = make_counting_line(counting_line_values)
    validate_options(counting_line, tracking, max_track_age_frames)
    input_path, weights_path, output_path, annotated_path = validate_paths(
        input_path, weights_path, output_path, annotated_path
    )
    cv2 = _load_cv2()
    capture = cv2.VideoCapture(str(input_path))
    if not capture.isOpened():
        capture.release()
        raise VisionError(f"unable to open input video: {input_path}")

    writer = None
    try:
        reported_fps = float(capture.get(cv2.CAP_PROP_FPS))
        if not math.isfinite(reported_fps) or reported_fps <= 0:
            reported_fps = None
        reported_frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if reported_frame_count <= 0:
            reported_frame_count = None

        frame_index = 0
        success, frame = capture.read()
        if not success or frame is None:
            raise VisionError(f"input video contains no decodable frames: {input_path}")

        height, width = frame.shape[:2]
        if counting_line is not None and (
            counting_line["x1"] >= width
            or counting_line["x2"] >= width
            or counting_line["y1"] >= height
            or counting_line["y2"] >= height
        ):
            raise VisionError(
                f"counting-line coordinates must fit within the {width}x{height} video"
            )

        resolved_device = _resolve_device(device)
        detector = UltralyticsDetector(
            weights_path, confidence, resolved_device, tracking
        )
        metrics = VideoMetrics(
            tracking=tracking,
            max_track_age_frames=max_track_age_frames,
            counting_line=counting_line,
        )

        if annotated_path is not None:
            annotated_path.parent.mkdir(parents=True, exist_ok=True)
            output_fps = reported_fps or 30.0
            extension = annotated_path.suffix.lower()
            fourcc_name = "XVID" if extension == ".avi" else "mp4v"
            writer = cv2.VideoWriter(
                str(annotated_path),
                cv2.VideoWriter_fourcc(*fourcc_name),
                output_fps,
                (width, height),
            )
            if not writer.isOpened():
                raise VisionError(
                    f"unable to create annotated video output: {annotated_path}"
                )

        started_at = time.perf_counter()
        while success and frame is not None:
            timestamp_ms = _read_timestamp_ms(capture, cv2, frame_index)
            detections = detector.infer(frame, frame_index)
            metrics.add_frame(frame_index, timestamp_ms, detections)
            if writer is not None:
                _draw_detections(cv2, frame, detections, counting_line)
                writer.write(frame)
            frame_index += 1
            success, frame = capture.read()
            if not success or frame is None:
                if _is_premature_read_failure(
                    capture, cv2, reported_frame_count, frame_index
                ):
                    raise VisionError(
                        f"video decoding failed before the reported end near "
                        f"frame {frame_index}: {input_path}"
                    )

        elapsed_seconds = time.perf_counter() - started_at
        analyzed = metrics.result(elapsed_seconds)
        document = build_document(
            video_metadata={
                "fileName": Path(input_path).name,
                "width": width,
                "height": height,
                "reportedFps": reported_fps,
                "reportedFrameCount": reported_frame_count,
            },
            configuration={
                "weightsPath": str(weights_path),
                "confidenceThreshold": confidence,
                "device": resolved_device,
                "requestedDevice": device,
                "trackingEnabled": tracking,
                "tracker": "ByteTrack" if tracking else None,
                "supportedClasses": ["car", "motorcycle", "bus", "truck"],
                "maxTrackAgeFrames": max_track_age_frames if tracking else None,
            },
            analyzed=analyzed,
        )
        write_json(document, output_path)
        return document
    finally:
        capture.release()
        if writer is not None:
            writer.release()
