# STM Offline Traffic Vision MVP

This isolated Python utility processes **recorded local video files**. Phase 1 detects vehicles with a local Ultralytics-compatible model; Phase 2 optionally tracks detections with Ultralytics ByteTrack. It does not connect to STM's API or database.

## Requirements and local model setup

- Python 3.10 or newer (the current package metadata and wheels also support Python 3.14 on Windows).
- Install the pinned detector and video packages:

  ```powershell
  python -m pip install -r ai-service\requirements.txt
  ```

- Obtain compatible weights separately and place them on disk. For example, download an Ultralytics YOLO detection checkpoint through the provider's normal distribution process, then pass its local `.pt` path. This CLI never downloads weights. No weights or videos belong in this repository.
- The model must expose the class names `car`, `motorcycle` (or `motorbike`), `bus`, and/or `truck`. Only classes present in the model are processed; a model with none of these classes is rejected.

The code has not been validated against a live pretrained checkpoint in this environment: OpenCV, Ultralytics, and model weights were not installed during implementation. Unit tests use synthetic detections and do not require network access, weights, or a GPU.

## Commands

Run from the repository root for dependency installation, then enter `ai-service` for the module commands:

```powershell
python -m pip install -r ai-service\requirements.txt
Set-Location ai-service
python -m traffic_vision.cli --input "C:\videos\traffic.mp4" --weights "C:\models\vehicle-detector.pt" --output "C:\results\traffic.json"
```

Enable tracking and annotated video output:

```powershell
python -m traffic_vision.cli --input "C:\videos\traffic.mp4" --weights "C:\models\vehicle-detector.pt" --output "C:\results\traffic.json" --tracking --annotated-video "C:\results\traffic-annotated.mp4" --device auto --confidence 0.25
```

Add optional directional flow counts using a line in **video pixel coordinates**:

```powershell
python -m traffic_vision.cli --input "C:\videos\traffic.mp4" --weights "C:\models\vehicle-detector.pt" --output "C:\results\traffic.json" --tracking --counting-line 640 0 640 720
```

`--device` accepts `auto`, `cpu`, or a non-negative GPU index such as `0`. `auto` selects CUDA device 0 when available, otherwise CPU. `--tracking` is optional. `--counting-line` requires tracking. The reporting active-track age defaults to 30 processed frames and can be changed with `--max-track-age-frames`; ByteTrack's own missed-detection behavior is controlled by its bundled `bytetrack.yaml`.

Run the dependency-light tests from `ai-service`:

```powershell
python -m unittest discover -s tests -v
```

## Output and metric definitions

The JSON document has `schemaVersion: 1`, video metadata, run configuration, per-frame results, and metrics. Each detection records its zero-based frame index, source timestamp in milliseconds when OpenCV reports one (otherwise `null`), class, confidence, `[x1, y1, x2, y2]` pixel bounding box, and `trackId` (`null` when tracking is disabled or ByteTrack has not assigned an ID).

- **Detection events** are individual detections in individual frames. They are not unique vehicles.
- Detection metrics include total and per-class detection events, average detections per processed frame, processed frames, elapsed processing time, and processing FPS.
- Tracking metrics include distinct observed tracker IDs and per-class distinct observed tracks. A track's class is its most frequently observed class (alphabetical tie-break). The active count means IDs seen within the configured frame-age window at end of video. Track IDs are tracker estimates, can fragment or switch, and are **not ground-truth vehicle identities**.
- Optional flow metrics count each observed track at most once in each crossing direction. Direction names refer to the signed sides of the directed line from its first endpoint to its second.
- Annotated output displays boxes, class, confidence, optional ID, and optional counting line. The container-reported FPS is used for output; when unavailable, annotated video uses 30 FPS.

## Limitations

This tool does not estimate physical speed, density, road occupancy, or ground-truth unique vehicles. It does not write STM measurements: STM's existing measurement schema requires a configured device and location plus `vehicleCount`, `averageSpeed`, and `trafficDensity`; detector events cannot safely supply those values. Camera calibration, occlusion, perspective, model-specific class labels, and tracker ID changes affect results. Use only video you are authorized to process.
