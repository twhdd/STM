from collections import Counter


class TrackingAccumulator:
    def __init__(self, max_age_frames=30, counting_line=None):
        if (
            isinstance(max_age_frames, bool)
            or not isinstance(max_age_frames, int)
            or max_age_frames < 0
        ):
            raise ValueError("max_age_frames must be a non-negative integer")
        self.max_age_frames = max_age_frames
        self.counting_line = counting_line
        self.tracks = {}
        self.previous_sides = {}
        self.counted_crossings = set()
        self.crossing_counts = Counter()

    def observe(self, frame_index, detections):
        for detection in detections:
            track_id = detection.track_id
            if track_id is None:
                continue
            track = self.tracks.setdefault(
                track_id,
                {"last_seen_frame": frame_index, "class_counts": Counter()},
            )
            track["last_seen_frame"] = frame_index
            track["class_counts"][detection.class_name] += 1
            if self.counting_line is not None:
                self._observe_crossing(track_id, detection)

    def _observe_crossing(self, track_id, detection):
        line = self.counting_line
        x1, y1 = line["x1"], line["y1"]
        x2, y2 = line["x2"], line["y2"]
        center_x = (detection.bbox[0] + detection.bbox[2]) / 2
        center_y = (detection.bbox[1] + detection.bbox[3]) / 2
        cross_product = (x2 - x1) * (center_y - y1) - (y2 - y1) * (
            center_x - x1
        )
        side = 1 if cross_product > 0 else -1 if cross_product < 0 else 0
        if side == 0:
            return

        previous_side = self.previous_sides.get(track_id)
        self.previous_sides[track_id] = side
        if previous_side is None or previous_side == side:
            return

        direction = (
            "negative_to_positive" if previous_side < side else "positive_to_negative"
        )
        crossing_key = (track_id, direction)
        if crossing_key not in self.counted_crossings:
            self.counted_crossings.add(crossing_key)
            self.crossing_counts[direction] += 1

    @staticmethod
    def _track_class(track):
        return min(
            track["class_counts"],
            key=lambda class_name: (-track["class_counts"][class_name], class_name),
        )

    def metrics(self, final_frame_index):
        active_tracks = {
            track_id: track
            for track_id, track in self.tracks.items()
            if final_frame_index - track["last_seen_frame"] <= self.max_age_frames
        }
        class_counts = Counter(self._track_class(track) for track in self.tracks.values())
        active_class_counts = Counter(
            self._track_class(track) for track in active_tracks.values()
        )
        return {
            "distinctObservedTrackIds": len(self.tracks),
            "activeTracks": len(active_tracks),
            "maxTrackAgeFrames": self.max_age_frames,
            "perClassTrackedVehicles": dict(sorted(class_counts.items())),
            "activeTracksByClass": dict(sorted(active_class_counts.items())),
        }

    def flow_metrics(self):
        if self.counting_line is None:
            return None
        return {
            "countingLine": dict(self.counting_line),
            "directionDefinitions": {
                "negative_to_positive": "from the negative to positive side of the directed line",
                "positive_to_negative": "from the positive to negative side of the directed line",
            },
            "crossings": {
                "negativeToPositive": self.crossing_counts["negative_to_positive"],
                "positiveToNegative": self.crossing_counts["positive_to_negative"],
            },
        }
