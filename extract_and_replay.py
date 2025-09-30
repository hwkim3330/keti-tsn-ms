#!/usr/bin/env python3
import re, codecs, argparse, subprocess

def extract_frames(log_path, out_path, fd=None):
    regex = re.compile(r'write\((\d+)<.*ttyACM0.*>,\s*"(.*)"')
    frames = []
    with open(log_path, 'r') as f:
        for line in f:
            m = regex.search(line)
            if not m: continue
            this_fd, payload = int(m.group(1)), m.group(2)
            if fd is not None and this_fd != fd: continue
            try:
                data = codecs.decode(payload, 'unicode_escape').encode('latin1')
                frames.append(data)
            except Exception as e:
                print(f"[warn] decode fail: {e}")
    if not frames:
        print("[err] no frames found"); return
    with open(out_path, 'wb') as out:
        for frame in frames: out.write(frame)
    print(f"[ok] wrote {sum(len(f) for f in frames)} bytes "
          f"from {len(frames)} frame(s) into {out_path}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("-l","--log",required=True)
    ap.add_argument("-o","--out",required=True)
    ap.add_argument("--fd",type=int)
    ap.add_argument("--replay",action="store_true")
    args=ap.parse_args()
    extract_frames(args.log,args.out,args.fd)
    if args.replay:
        subprocess.run('printf ">p<<8553" | sudo tee /dev/ttyACM0',shell=True)
        subprocess.run(f'sudo cat {args.out} > /dev/ttyACM0',shell=True)
        print("[ok] replay sent")
