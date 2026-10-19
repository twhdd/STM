import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

from traffic_vision.metrics import Detection
from traffic_vision.runner import run_video
from traffic_vision.validation import VisionError


class FakeCapture:
    def __init__(
        self,
        _path,
        reported_frame_count=None,
        decoded_frame_count=2,
        fail_after_decoded=None,
        unavailable_timestamps=False,
    ):
        self.frames = [
            types.SimpleNamespace(shape=(48, 64, 3), index=index)
            for index in range(decoded_frame_count)
        ]
        self.reported_frame_count = reported_frame_count
        self.fail_after_decoded = fail_after_decoded
        self.unavailable_timestamps = unavailable_timestamps
        self.position = -1
        self.decoded_frames = 0
        self.released = False

    def isOpened(self):
        return True

    def get(self, property_id):
        if property_id == 1:
            return 25.0
        if property_id == 2:
            return (
                len(self.frames)
                if self.reported_frame_count is None
                else self.reported_frame_count
            )
        if property_id == 3:
            return 0 if self.unavailable_timestamps else max(self.position, 0) * 40.0
        if property_id == 4:
            return max(self.position + 1, 0)
        if property_id == 5:
            if self.fail_after_decoded is not None and self.decoded_frames >= self.fail_after_decoded:
                return self.decoded_frames / len(self.frames)
            return 1.0 if self.decoded_frames >= len(self.frames) else (
                self.decoded_frames / len(self.frames)
            )
        return 0

    def read(self):
        if (
            self.fail_after_decoded is not None
            and self.decoded_frames >= self.fail_after_decoded
        ):
            self.position = self.decoded_frames
            return False, None
        self.position += 1
        if self.position >= len(self.frames):
            return False, None
        self.decoded_frames += 1
        return True, self.frames[self.position]

    def release(self):
        self.released = True


class RunnerTests(unittest.TestCase):
    def test_video_frames_are_processed_incrementally_and_written(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "recorded.mp4"
            weights = root / "local.pt"
            output = root / "result.json"
            video.touch()
            weights.touch()
            capture = FakeCapture(video)
            cv2 = types.SimpleNamespace(
                VideoCapture=lambda _path: capture,
                CAP_PROP_FPS=1,
                CAP_PROP_FRAME_COUNT=2,
                CAP_PROP_POS_MSEC=3,
                CAP_PROP_POS_FRAMES=4,
                CAP_PROP_POS_AVI_RATIO=5,
            )

            class FakeDetector:
                def __init__(self):
                    self.processed_frames = []

                def infer(self, frame, frame_index):
                    self.processed_frames.append((frame.index, frame_index))
                    return [
                        Detection(
                            "car",
                            0.8,
                            (1, 2, 11, 12),
                            track_id=5,
                        )
                    ]

            detector = FakeDetector()
            with (
                patch("traffic_vision.runner._load_cv2", return_value=cv2),
                patch("traffic_vision.runner.UltralyticsDetector", return_value=detector),
            ):
                document = run_video(
                    video,
                    weights,
                    output,
                    device="cpu",
                    tracking=True,
                )

            saved = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(detector.processed_frames, [(0, 0), (1, 1)])
            self.assertTrue(capture.released)
            self.assertEqual(document["metrics"]["detection"]["framesProcessed"], 2)
            self.assertEqual(document["metrics"]["tracking"]["distinctObservedTrackIds"], 1)
            self.assertEqual(saved["frames"][0]["timestampMs"], 0)
            self.assertEqual(saved["frames"][1]["timestampMs"], 40)

    def test_capture_is_released_when_inference_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "recorded.mp4"
            weights = root / "local.pt"
            video.touch()
            weights.touch()
            capture = FakeCapture(video)
            cv2 = types.SimpleNamespace(
                VideoCapture=lambda _path: capture,
                CAP_PROP_FPS=1,
                CAP_PROP_FRAME_COUNT=2,
                CAP_PROP_POS_MSEC=3,
                CAP_PROP_POS_FRAMES=4,
                CAP_PROP_POS_AVI_RATIO=5,
            )

            class FailingDetector:
                def __init__(self, *_args):
                    pass

                def infer(self, _frame, frame_index):
                    raise VisionError(f"inference failed on frame {frame_index}")

            with (
                patch("traffic_vision.runner._load_cv2", return_value=cv2),
                patch("traffic_vision.runner.UltralyticsDetector", FailingDetector),
                self.assertRaisesRegex(VisionError, "inference failed on frame 0"),
            ):
                run_video(
                    video,
                    weights,
                    root / "result.json",
                    device="cpu",
                )

            self.assertTrue(capture.released)

    def test_empty_video_is_rejected_before_loading_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "empty.mp4"
            weights = root / "local.pt"
            video.touch()
            weights.touch()
            capture = FakeCapture(video)
            capture.frames = []
            cv2 = types.SimpleNamespace(
                VideoCapture=lambda _path: capture,
                CAP_PROP_FPS=1,
                CAP_PROP_FRAME_COUNT=2,
                CAP_PROP_POS_MSEC=3,
                CAP_PROP_POS_FRAMES=4,
                CAP_PROP_POS_AVI_RATIO=5,
            )

            with (
                patch("traffic_vision.runner._load_cv2", return_value=cv2),
                patch("traffic_vision.runner.UltralyticsDetector") as detector_class,
                self.assertRaisesRegex(VisionError, "no decodable frames"),
            ):
                run_video(
                    video,
                    weights,
                    root / "result.json",
                    device="cpu",
                )

            detector_class.assert_not_called()
            self.assertTrue(capture.released)

    def test_unavailable_timestamps_are_null_but_first_zero_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "recorded.mp4"
            weights = root / "local.pt"
            video.touch()
            weights.touch()
            capture = FakeCapture(video, unavailable_timestamps=True)
            cv2 = types.SimpleNamespace(
                VideoCapture=lambda _path: capture,
                CAP_PROP_FPS=1,
                CAP_PROP_FRAME_COUNT=2,
                CAP_PROP_POS_MSEC=3,
                CAP_PROP_POS_FRAMES=4,
                CAP_PROP_POS_AVI_RATIO=5,
            )

            with (
                patch("traffic_vision.runner._load_cv2", return_value=cv2),
                patch(
                    "traffic_vision.runner.UltralyticsDetector",
                    return_value=types.SimpleNamespace(infer=lambda *_args: []),
                ),
            ):
                document = run_video(
                    video,
                    weights,
                    root / "result.json",
                    device="cpu",
                )

            self.assertEqual(
                [frame["timestampMs"] for frame in document["frames"]],
                [0, None],
            )

    def test_midstream_read_failure_raises_and_releases_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "recorded.mp4"
            weights = root / "local.pt"
            output = root / "result.json"
            video.touch()
            weights.touch()
            capture = FakeCapture(
                video,
                reported_frame_count=8,
                decoded_frame_count=8,
                fail_after_decoded=3,
            )
            cv2 = types.SimpleNamespace(
                VideoCapture=lambda _path: capture,
                CAP_PROP_FPS=1,
                CAP_PROP_FRAME_COUNT=2,
                CAP_PROP_POS_MSEC=3,
                CAP_PROP_POS_FRAMES=4,
                CAP_PROP_POS_AVI_RATIO=5,
            )

            with (
                patch("traffic_vision.runner._load_cv2", return_value=cv2),
                patch(
                    "traffic_vision.runner.UltralyticsDetector",
                    return_value=types.SimpleNamespace(infer=lambda *_args: []),
                ),
                self.assertRaisesRegex(VisionError, "decoding failed before the reported end"),
            ):
                run_video(video, weights, output, device="cpu")

            self.assertTrue(capture.released)
            self.assertFalse(output.exists())

    def test_inaccurate_reported_frame_count_does_not_reject_normal_eof(self):
        for reported_count in (0, 1, 100):
            with self.subTest(reported_count=reported_count), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                video = root / "recorded.mp4"
                weights = root / "local.pt"
                output = root / "result.json"
                video.touch()
                weights.touch()
                capture = FakeCapture(
                    video,
                    reported_frame_count=reported_count,
                    decoded_frame_count=8,
                )
                cv2 = types.SimpleNamespace(
                    VideoCapture=lambda _path: capture,
                    CAP_PROP_FPS=1,
                    CAP_PROP_FRAME_COUNT=2,
                    CAP_PROP_POS_MSEC=3,
                    CAP_PROP_POS_FRAMES=4,
                    CAP_PROP_POS_AVI_RATIO=5,
                )

                with (
                    patch("traffic_vision.runner._load_cv2", return_value=cv2),
                    patch(
                        "traffic_vision.runner.UltralyticsDetector",
                        return_value=types.SimpleNamespace(infer=lambda *_args: []),
                    ),
                ):
                    document = run_video(
                        video,
                        weights,
                        output,
                        device="cpu",
                    )

                self.assertEqual(
                    document["metrics"]["detection"]["framesProcessed"],
                    len(capture.frames),
                )
                self.assertTrue(output.exists())


if __name__ == "__main__":
    unittest.main()
