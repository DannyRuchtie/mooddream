# Moondream Station Helper

This folder contains tools to drive a locally running [Moondream Station](https://moondream.ai/blog/moondream-station-m3-preview) service:

- `moondream_batch.py` – batch caption/query/detect photos via the REST API.
- `webapp/` – lightweight Flask UI where you can drop an image, read the caption, and render bounding boxes (“segments”) over the photo.

## 1. Start Moondream Station

1. Make sure the pip `bin` directory is on `PATH`:

   ```bash
   export PATH="$HOME/Library/Python/3.9/bin:$PATH"
   ```

2. Launch the CLI (outside this sandbox so it can create `~/.moondream-station`):

   ```bash
   moondream-station
   ```

3. Inside the REPL:
   - `models list` – inspect available models.
   - `models switch <name>` – pick the one you want.
   - `start` – spin up the REST API (defaults to `http://127.0.0.1:2020/v1`).

4. Optional sanity check from another terminal:

   ```bash
   curl -s http://127.0.0.1:2020/health
   ```

   You should see `{ "status": "ok", ... }` once the service is ready.

## 2. Batch Photos With `moondream_batch.py`

Run the helper script from this folder once the REST API is live:

```bash
python3 moondream_batch.py <files-or-folders> \
  --function caption \
  --length normal \
  --output-dir captions
```

Key flags:

- `--function` – model function to call (`caption`, `query`, `detect`, etc.).
- `--question` – text prompt; sets both `question` and `object` payload fields.
- `--length` – `short`, `normal`, or `long` caption hint (caption function only).
- `--param key=value` – add arbitrary payload fields; repeat for multiple pairs.
- `--output-dir path` – optional folder to store one `.txt` file per image.
- `--endpoint URL` – change the base URL if you run the API on another host/port.

Examples:

```bash
# Caption every image in a folder and save outputs next to the console text
python3 moondream_batch.py ~/Pictures/new_shoot --function caption --length long --output-dir captions

# Ask a question about a batch of photos
python3 moondream_batch.py ~/Desktop/dropbox --function query --question "What product is featured?" --output-dir qna
```

The script automatically walks directories, filters for common image extensions, avoids duplicates, and prints token stats when the API returns them. If a request fails it keeps going with the remaining images.

## 3. Web Interface (Caption + Segment)

Use the Flask UI when you want a friendly drag-and-drop experience with a live preview and bounding boxes drawn over the image:

```bash
cd webapp
python3 -m venv .venv && source .venv/bin/activate  # optional but recommended
pip install -r requirements.txt
python3 app.py  # runs on http://127.0.0.1:8080
```

Leave Moondream Station running on port 2020. The web UI will:

1. Accept a dropped/uploaded image.
2. Call `/v1/caption` for the caption (length selector in the UI).
3. Optionally call `/v1/detect` if you provide a target object (e.g., “person”).
4. Render translucent rectangles (“segments”) over the preview using the returned bounding boxes, plus show any errors inline if the backend can’t detect that object.

If Moondream Station runs on a non-default URL, set `MOONDREAM_ENDPOINT` before launching Flask:

```bash
export MOONDREAM_ENDPOINT="http://127.0.0.1:3030"
python3 app.py
```

## 4. One-Off Inference (Optional)

Instead of batching or using the UI you can stay entirely inside the Moondream Station REPL:

```bash
infer caption /path/to/image.jpg normal
infer query /path/to/image.png "What is happening?"
```

Use whichever workflow fits your needs—everything ultimately hits the same local REST service.
