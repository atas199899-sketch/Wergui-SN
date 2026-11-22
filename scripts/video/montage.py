import json, subprocess, os, sys
B = os.path.dirname(os.path.abspath(__file__)) + ('/build_court/' if os.environ.get('COURT') else '/build/'); tl = json.load(open(B + 'timeline.json')); X = 0.5; FPS = 30
NOM = sys.argv[1] if len(sys.argv) > 1 else 'Wergui_SN_presentation'
run = lambda c: subprocess.run(c, check=True, capture_output=True)
n = len(tl)
for t in tl:
    i = t['i']; L = t['duree'] + (X if i < n - 1 else 0); N = int(L * FPS); zmax = 1.025 if i in (0, n - 1) else 1.045
    run(['ffmpeg', '-y', '-v', 'error', '-loop', '1', '-framerate', str(FPS), '-t', f'{L:.3f}', '-i', f'{B}s{i:02d}.png', '-vf',
         f"scale=3840:2160,zoompan=z='1+({zmax}-1)*on/{N}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps={FPS},format=yuv420p",
         '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', f'{B}c{i:02d}.mp4'])
    print('séquence', i, f'{L:.1f}s', flush=True)
with open(B + 'audio.txt', 'w') as f: f.writelines(f"file 'a{t['i']:02d}.wav'\n" for t in tl)
run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', B + 'audio.txt', '-c', 'pcm_s16le', B + 'voix.wav'])
ins = sum([['-i', f'{B}c{t["i"]:02d}.mp4'] for t in tl], [])
g, last, off = [], '[0:v]', 0.0
for k in range(1, n):
    off += tl[k - 1]['duree']; out = f'[v{k}]'
    g.append(f"{last}[{k}:v]xfade=transition=fade:duration={X}:offset={off:.3f}{out}"); last = out
g.append(f"{last}ass={B}sous-titres.ass:fontsdir=/usr/share/fonts/opentype/inter[vout]")
run(['ffmpeg', '-y', '-v', 'error'] + ins + ['-i', B + 'voix.wav', '-filter_complex', ";".join(g), '-map', '[vout]', '-map', f'{n}:a',
     '-af', 'apad', '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', f'{B}../{NOM}.mp4'])
print('vidéo ok')
