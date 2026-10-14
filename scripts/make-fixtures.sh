#!/usr/bin/env bash
# Generates speech fixtures with espeak-ng and ffmpeg. Run in CI (ubuntu) by vendor-models.yml.
# All text is synthetic and contains no sensitive content.
set -euo pipefail
cd "$(dirname "$0")/.."
F=tests/fixtures
mkdir -p "$F"
say() { espeak-ng -v en-us -s "${3:-145}" -w "$2" "$1"; }
to16k() { ffmpeg -loglevel error -y -i "$1" -ac 1 -ar 16000 "$2"; }

# 1. Ten second smoke fixture.
SMOKE="The quick brown fox jumps over the lazy dog. Open the supply closet and check the printer paper."
say "$SMOKE" /tmp/smoke.wav 130
ffmpeg -loglevel error -y -i /tmp/smoke.wav -af "apad=whole_dur=10" -t 10 -ac 1 -ar 16000 "$F/smoke-10s.wav"
cat > "$F/smoke-expected.json" <<JSON
{ "sentence": "$SMOKE", "mustContain": ["quick", "brown", "fox", "lazy", "dog", "printer", "paper"] }
JSON

# 2. Forty five second clip whose final sentence starts after 30 seconds (chunking check), in every accepted format.
P1="Step one. Sign in to the scheduling system with your university account."
P2="Step two. Select the campus and the room you want to reserve."
P3="Step three. Choose the date, the start time and the end time."
P4="Step four. Add a short description of the event and the expected head count."
P5="Final step. The closing words of this recording are blue lantern harbor."
i=0; for p in "$P1" "$P2" "$P3" "$P4"; do i=$((i+1)); say "$p" /tmp/p$i.wav 140; done
say "$P5" /tmp/p5.wav 140
# Pad each part so the final sentence begins at about 32 seconds.
ffmpeg -loglevel error -y -i /tmp/p1.wav -i /tmp/p2.wav -i /tmp/p3.wav -i /tmp/p4.wav -i /tmp/p5.wav -filter_complex \
 "[0]apad=whole_dur=8[a];[1]apad=whole_dur=8[b];[2]apad=whole_dur=8[c];[3]apad=whole_dur=8[d];[4]apad=whole_dur=13[e];[a][b][c][d][e]concat=n=5:v=0:a=1,aresample=16000" \
 -ac 1 /tmp/clip45.wav
cp /tmp/clip45.wav "$F/clip-45s.wav"
ffmpeg -loglevel error -y -i /tmp/clip45.wav -c:a libmp3lame -b:a 64k "$F/clip-45s.mp3"
ffmpeg -loglevel error -y -i /tmp/clip45.wav -c:a aac -b:a 64k "$F/clip-45s.m4a"
ffmpeg -loglevel error -y -f lavfi -i "color=c=0x1d2b3a:s=320x240:r=10" -i /tmp/clip45.wav -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 64k "$F/clip-45s.mp4"
ffmpeg -loglevel error -y -f lavfi -i "color=c=0x3a2b1d:s=320x240:r=10" -i /tmp/clip45.wav -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 64k -f mov "$F/clip-45s.mov"
echo '{ "finalWords": ["blue", "lantern", "harbor"] }' > "$F/clip-45s-expected.json"

# 3. Three minute reference clip for Gate 2 (numbered sentences, about 180 s).
: > /tmp/ref.txt
for n in $(seq 1 40); do echo "Sentence $n. Record the item count on line $n of the inventory sheet." >> /tmp/ref.txt; done
espeak-ng -v en-us -s 150 -f /tmp/ref.txt -w /tmp/ref.wav
ffmpeg -loglevel error -y -i /tmp/ref.wav -t 180 -ac 1 -ar 16000 -c:a libmp3lame -b:a 48k "$F/ref-3min.mp3"

# 4. Twenty five minute recording for the 10 minute boundary test.
: > /tmp/long.txt
for n in $(seq 1 330); do echo "Marker $n. Check the door, the lights, and the thermostat in room $n." >> /tmp/long.txt; done
espeak-ng -v en-us -s 150 -f /tmp/long.txt -w /tmp/long.wav
ffmpeg -loglevel error -y -i /tmp/long.wav -t 1500 -ac 1 -ar 16000 -c:a libmp3lame -b:a 32k "$F/long-25min.mp3"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$F/long-25min.mp3"
ls -la "$F"
