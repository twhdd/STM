import sys
import types
import unittest
from unittest.mock import patch

from traffic_vision.detector import UltralyticsDetector
from traffic_vision.metrics import VideoMetrics


class Scalar:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class Box:
    cls = Scalar(2)
    conf = Scalar(0.9)
    xyxy = [types.SimpleNamespace(tolist=lambda: [1, 2, 11, 12])]
    id = Scalar(7)


class FakeModel:
    names = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

    def __init__(self):
        self.track_calls = []
        self.predict_calls = []

    def track(self, frame, **kwargs):
        self.track_calls.append(kwargs)
        return [types.SimpleNamespace(boxes=[Box()])]

    def predict(self, frame, **kwargs):
        self.predict_calls.append(kwargs)
        return [types.SimpleNamespace(boxes=[Box()])]


class DetectorTests(unittest.TestCase):
    def test_tracking_predictions_feed_persistent_ids_to_metrics(self):
        model = FakeModel()
        fake_module = types.SimpleNamespace(YOLO=lambda weights: model)
        with patch.dict(sys.modules, {"ultralytics": fake_module}):
            detector = UltralyticsDetector("local.pt", 0.25, "cpu", True)

        metrics = VideoMetrics(tracking=True)
        metrics.add_frame(0, 0, detector.infer(object(), 0))
        metrics.add_frame(1, 40, detector.infer(object(), 1))

        self.assertEqual(
            [call["persist"] for call in model.track_calls],
            [True, True],
        )
        self.assertEqual(
            [call["tracker"] for call in model.track_calls],
            ["bytetrack.yaml", "bytetrack.yaml"],
        )
        self.assertEqual(model.track_calls[0]["classes"], [2, 3, 5, 7])
        result = metrics.result(0.1)
        self.assertEqual(
            result["metrics"]["detection"]["totalDetectionEvents"],
            2,
        )
        self.assertEqual(
            result["metrics"]["tracking"]["distinctObservedTrackIds"],
            1,
        )
        self.assertEqual(
            [frame["detections"][0]["trackId"] for frame in result["frames"]],
            [7, 7],
        )

    def test_detection_mode_uses_predict_without_emitting_track_ids(self):
        model = FakeModel()
        fake_module = types.SimpleNamespace(YOLO=lambda weights: model)
        with patch.dict(sys.modules, {"ultralytics": fake_module}):
            detector = UltralyticsDetector("local.pt", 0.25, "cpu", False)

        detection = detector.infer(object(), 0)[0]

        self.assertEqual(len(model.predict_calls), 1)
        self.assertEqual(model.track_calls, [])
        self.assertEqual(detection.class_name, "car")
        self.assertIsNone(detection.track_id)


if __name__ == "__main__":
    unittest.main()
