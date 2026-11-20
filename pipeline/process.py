#!/usr/bin/env python3
"""Turn a short character video into game-ready animation for Bingsu's Bakery. Free and local.

  python3 process.py clip.mp4 --name cat_idle            # writes to site/bakery/anim/
  python3 process.py clip.mp4 --name bun_wave --frames 16 --size 256

Steps: extract frames (ffmpeg) -> remove the solid background (colour sampled from the corners,
so ask the video tool for a plain green or plain colour background) -> crop every frame to the
same box -> pick the frames that loop best -> write a sprite sheet, a JSON file, an animated WebP
and a preview GIF.
"""
import argparse, json, os, subprocess, sys, tempfile
from PIL import Image

def frames_from(video, fps, tmp):
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', video, '-vf', f'fps={fps}', os.path.join(tmp, 'f%04d.png')], check=True)
    return [Image.open(os.path.join(tmp, f)).convert('RGBA') for f in sorted(os.listdir(tmp)) if f.endswith('.png')]

def key_colour(im):
    w, h = im.size; px = im.load(); pts = [(2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3), (w // 2, 2), (2, h // 2), (w - 3, h // 2)]
    cs = sorted(px[p][:3] for p in pts); return cs[len(cs) // 2]

def remove_bg(im, key, tol, soft):
    kr, kg, kb = key; px = im.load(); w, h = im.size
    green = kg > kr + 40 and kg > kb + 40
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            d = ((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2) ** .5
            if d < tol: px[x, y] = (r, g, b, 0)
            elif d < tol + soft:
                k = (d - tol) / soft
                if green and g > max(r, b): g = max(r, b)   # remove green fringe
                px[x, y] = (r, g, b, int(255 * k))
            elif green and g > max(r, b) + 20: px[x, y] = (r, max(r, b) + 20, b, a)   # spill
    return im

def best_loop(frames, n):
    """Choose n consecutive frames whose last frame is closest to the first, so the loop doesn't jump."""
    if len(frames) <= n: return frames
    small = [f.resize((48, 48)).convert('RGB') for f in frames]
    def diff(a, b): return sum(abs(x - y) for p, q in zip(a.get_flattened_data() if hasattr(a, 'get_flattened_data') else a.getdata(), b.get_flattened_data() if hasattr(b, 'get_flattened_data') else b.getdata()) for x, y in zip(p, q))
    best, start = None, 0
    for s in range(0, len(frames) - n + 1):
        d = diff(small[s], small[s + n - 1] if s + n < len(frames) else small[-1])
        if best is None or d < best: best, start = d, s
    return frames[start:start + n]

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('video'); ap.add_argument('--name', required=True)
    ap.add_argument('--fps', type=float, default=12, help='frames per second to sample (default 12)')
    ap.add_argument('--frames', type=int, default=0, help='keep this many frames, chosen to loop smoothly (default: all)')
    ap.add_argument('--size', type=int, default=256, help='longest side of each frame in pixels (default 256)')
    ap.add_argument('--tol', type=float, default=60, help='background tolerance (raise if specks of background remain)')
    ap.add_argument('--keep-bg', action='store_true', help="don't remove the background")
    ap.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'site', 'bakery', 'anim'))
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        frames = frames_from(a.video, a.fps, tmp)
    if not frames: sys.exit('No frames found in the video.')
    if not a.keep_bg:
        key = key_colour(frames[0]); print(f'background colour {key}, {len(frames)} frames')
        frames = [remove_bg(f, key, a.tol, 40) for f in frames]
    if a.frames: frames = best_loop(frames, a.frames)
    # one crop box for every frame, so the character never jumps around
    box = None
    for f in frames:
        b = f.getbbox()
        if b: box = b if not box else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    if box: frames = [f.crop(box) for f in frames]
    k = a.size / max(frames[0].size); size = (max(1, round(frames[0].width * k)), max(1, round(frames[0].height * k)))
    frames = [f.resize(size, Image.LANCZOS) for f in frames]
    cols = min(len(frames), 8); rows = (len(frames) + cols - 1) // cols
    sheet = Image.new('RGBA', (cols * size[0], rows * size[1]))
    for i, f in enumerate(frames): sheet.paste(f, ((i % cols) * size[0], (i // cols) * size[1]))
    base = os.path.join(a.out, a.name)
    sheet.save(base + '.png', optimize=True)
    json.dump({'frames': len(frames), 'w': size[0], 'h': size[1], 'cols': cols, 'fps': a.fps}, open(base + '.json', 'w'))
    ms = int(1000 / a.fps)
    frames[0].save(base + '.webp', save_all=True, append_images=frames[1:], duration=ms, loop=0, lossless=False, quality=85)
    prev = [Image.alpha_composite(Image.new('RGBA', size, (253, 240, 223, 255)), f).convert('P', palette=Image.ADAPTIVE) for f in frames]
    prev[0].save(base + '_preview.gif', save_all=True, append_images=prev[1:], duration=ms, loop=0)
    print(f'wrote {base}.png (sprite sheet {cols}x{rows}), .json, .webp, _preview.gif: {len(frames)} frames at {size[0]}x{size[1]}')

if __name__ == '__main__': main()
