from .metrics import Detection
from .validation import SUPPORTED_CLASSES, VisionError


class UltralyticsDetector:
    def __init__(self, weights_path, confidence, device, tracking):
        try:
            from ultralytics import YOLO
        except ImportError as error:
            raise VisionError(
                "Ultralytics is not installed; install ai-service/requirements.txt"
            ) from error

        try:
            self.model = YOLO(str(weights_path))
        except Exception as error:
            raise VisionError(f"unable to load local model weights: {error}") from error

        self.confidence = confidence
        self.device = device
        self.tracking = tracking
        names = self.model.names
        name_items = names.items() if isinstance(names, dict) else enumerate(names)
        self.class_ids = []
        self.class_names = {}
        for class_id, label in name_items:
            canonical_name = SUPPORTED_CLASSES.get(str(label).strip().lower())
            if canonical_name is not None:
                self.class_ids.append(int(class_id))
                self.class_names[int(class_id)] = canonical_name
        if not self.class_ids:
            raise VisionError(
                "model contains none of the supported classes: car, motorcycle, bus, truck"
            )

    def infer(self, frame, frame_index):
        try:
            if self.tracking:
                results = self.model.track(
                    frame,
                    persist=True,
                    tracker="bytetrack.yaml",
                    conf=self.confidence,
                    classes=self.class_ids,
                    device=self.device,
                    verbose=False,
                )
            else:
                results = self.model.predict(
                    frame,
                    conf=self.confidence,
                    classes=self.class_ids,
                    device=self.device,
                    verbose=False,
                )
            result = results[0]
            detections = []
            if result.boxes is None:
                return detections

            for box in result.boxes:
                class_id = int(box.cls.item())
                class_name = self.class_names.get(class_id)
                if class_name is None:
                    continue
                track_id = None
                if self.tracking and box.id is not None:
                    track_id = int(box.id.item())
                coordinates = tuple(float(value) for value in box.xyxy[0].tolist())
                detections.append(
                    Detection(
                        class_name=class_name,
                        confidence=float(box.conf.item()),
                        bbox=coordinates,
                        track_id=track_id,
                    )
                )
            return detections
        except Exception as error:
            raise VisionError(
                f"inference failed on frame {frame_index}: {error}"
            ) from error
