import unittest

from traffic_vision.metrics import Detection, VideoMetrics
from traffic_vision.tracking import TrackingAccumulator


def detection(class_name="car", track_id=None, center=(5, 5)):
    x, y = center
    return Detection(class_name, 0.9, (x - 1, y - 1, x + 1, y + 1), track_id)


class VideoMetricsTests(unittest.TestCase):
    def test_detection_metrics_are_hand_checkable(self):
        metrics = VideoMetrics()
        metrics.add_frame(0, 0, [detection(), detection("bus")])
        metrics.add_frame(1, 40, [])
        result = metrics.result(2.0)

        self.assertEqual(result["metrics"]["detection"]["totalDetectionEvents"], 2)
        self.assertEqual(
            result["metrics"]["detection"]["perClassDetectionEvents"],
            {"bus": 1, "car": 1},
        )
        self.assertEqual(
            result["metrics"]["detection"]["averageDetectionsPerProcessedFrame"],
            1,
        )
        self.assertEqual(result["metrics"]["detection"]["framesProcessed"], 2)
        self.assertEqual(result["metrics"]["detection"]["processingFps"], 1)
        self.assertEqual(result["metrics"]["tracking"], None)

    def test_track_metrics_count_unique_ids_not_detection_events(self):
        metrics = VideoMetrics(tracking=True, max_track_age_frames=1)
        metrics.add_frame(
            0,
            0,
            [detection("car", 10), detection("motorcycle", 20)],
        )
        metrics.add_frame(1, 33, [detection("car", 10), detection("car", None)])
        metrics.add_frame(2, 66, [detection("bus", 30)])
        result = metrics.result(1.5)["metrics"]["tracking"]

        self.assertEqual(result["distinctObservedTrackIds"], 3)
        self.assertEqual(result["activeTracks"], 2)
        self.assertEqual(
            result["perClassTrackedVehicles"],
            {"bus": 1, "car": 1, "motorcycle": 1},
        )
        self.assertEqual(result["activeTracksByClass"], {"bus": 1, "car": 1})

    def test_track_ids_without_detection_ids_are_not_counted(self):
        accumulator = TrackingAccumulator()
        accumulator.observe(0, [detection(track_id=None)])
        self.assertEqual(accumulator.metrics(0)["distinctObservedTrackIds"], 0)

    def test_directional_crossings_count_each_track_once_per_direction(self):
        line = {"x1": 5.0, "y1": 0.0, "x2": 5.0, "y2": 10.0}
        accumulator = TrackingAccumulator(counting_line=line)
        accumulator.observe(0, [detection(track_id=1, center=(3, 5))])
        accumulator.observe(1, [detection(track_id=1, center=(7, 5))])
        accumulator.observe(2, [detection(track_id=1, center=(3, 5))])
        accumulator.observe(3, [detection(track_id=1, center=(7, 5))])

        crossings = accumulator.flow_metrics()["crossings"]
        self.assertEqual(crossings["negativeToPositive"], 1)
        self.assertEqual(crossings["positiveToNegative"], 1)

    def test_new_accumulator_resets_tracking_state_between_videos(self):
        first_video = TrackingAccumulator()
        first_video.observe(0, [detection(track_id=1)])
        second_video = TrackingAccumulator()

        self.assertEqual(first_video.metrics(0)["distinctObservedTrackIds"], 1)
        self.assertEqual(second_video.metrics(0)["distinctObservedTrackIds"], 0)


if __name__ == "__main__":
    unittest.main()
