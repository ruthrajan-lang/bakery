# Animation pipeline (free)

Turn a short video of a character into a game-ready animation.

## 1. Make a clip (free tiers)
Kling, Hailuo (MiniMax), Pika or Meta AI: upload the character PNG and ask for, for example:

> Gentle idle breathing loop. The character stays in place, facing forward, same art style.
> **Plain solid bright green background**, no camera movement, no other objects. 3–5 seconds.

Other moves: "waves one paw", "bounces happily", "blinks slowly", "falls asleep and breathes".
Download the MP4. The plain green background is what lets the pipeline cut the character out for free.

## 2. Process it
```
python3 focus-bakery/pipeline/process.py clip.mp4 --name bun_wave --frames 12
```
Writes to `site/bakery/anim/`:
- `bun_wave.png`: sprite sheet (8 frames per row)
- `bun_wave.json`: frame count, size, columns, fps
- `bun_wave.webp`: animated WebP
- `bun_wave_preview.gif`: preview on the bakery's cream background, to check it quickly

Options: `--fps 12` (frames sampled per second), `--frames 12` (keep this many, chosen to loop
smoothly), `--size 256` (longest side), `--tol 60` (raise if specks of green remain), `--keep-bg`.
Needs ffmpeg and Python Pillow.
