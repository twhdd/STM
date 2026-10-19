from collections import Counter
from dataclasses import dataclass
import math

from .tracking import TrackingAccumulator


@dataclass(frozen=True)
class Detection:
    class_name: str
    confidence: float
    bbox: tuple
    track_id: int | None = None

    def __post_init__(self):
        if not self.class_name:
            raise ValueError("detection class name must not be empty")
        if not math.isfinite(self.confidence) or not 0 <= self.confidence <= 1:
            raise ValueError("detection confidence must be finite and between 0 and 1")
        if len(self.bbox) != 4 or not all(math.isfinite(value) for value in self.bbox):
            raise ValueError("bounding box must contain four finite coordinates")
        x1, y1, x2, y2 = self.bbox
        if x2 < x1 or y2 < y1:
            raise ValueError("bounding-box maximum coordinates must not precede minimums")

    def to_dict(self):
        return {
            "class": self.class_name,
            "confidence": float(self.confidence),
            "bbox": [float(value) for value in self.bbox],
            "trackId": self.track_id,
        }


class VideoMetrics:
    def __init__(self, tracking=False, max_track_age_frames=30, counting_line=None):
        self.frame_results = []
        self.class_detection_counts = Counter()
        self.tracking = (
            TrackingAccumulator(max_track_age_frames, counting_line)
            if tracking
            else None
        )

    def add_frame(self, frame_index, timestamp_ms, detections):
        detections = list(detections)
        self.frame_results.append(
            {
                "frameIndex": frame_index,
                "timestampMs": timestamp_ms,
                "detections": [detection.to_dict() for detection in detections],
            }
        )
        self.class_detection_counts.update(
            detection.class_name for detection in detections
        )
        if self.tracking is not None:
            self.tracking.observe(frame_index, detections)

    def result(self, elapsed_seconds):
        frames_processed = len(self.frame_results)
        total_events = sum(self.class_detection_counts.values())
        detection_metrics = {
            "totalDetectionEvents": total_events,
            "perClassDetectionEvents": dict(sorted(self.class_detection_counts.items())),
            "averageDetectionsPerProcessedFrame": (
                total_events / frames_processed if frames_processed else 0.0
            ),
            "framesProcessed": frames_processed,
            "processingTimeSeconds": elapsed_seconds,
            "processingFps": (
                frames_processed / elapsed_seconds if elapsed_seconds > 0 else 0.0
            ),
        }
        final_frame_index = (
            self.frame_results[-1]["frameIndex"] if self.frame_results else -1
        )
        tracking_metrics = (
            self.tracking.metrics(final_frame_index)
            if self.tracking is not None
            else None
        )
        flow_metrics = self.tracking.flow_metrics() if self.tracking else None
        return {
            "frames": self.frame_results,
            "metrics": {
                "detection": detection_metrics,
                "tracking": tracking_metrics,
                "flow": flow_metrics,
            },
        }
