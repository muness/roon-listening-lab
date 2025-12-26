# Roon Listening Lab

Guided ear training for audiophiles. Connects to your Roon setup and uses an LLM coach to suggest tracks that reveal your system's strengths—with timestamps and listening notes.

## What it does

Ask the coach about your audio chain and get targeted track suggestions you can play directly:

```
> a HQPlayer PCM -> iFi Zen Stream -> Mercury Pegasus -> WA6 -> ZMF Atticus.
  What is this chain great at, why, tracks that show that off.

Thinking...

Your audio chain is excellent for delivering a warm, dynamic, and detailed
sound profile. Here's why:

1. **HQPlayer**: Fantastic for upsampling and using advanced digital filters,
   which can improve detail and imaging.
2. **iFi Zen Stream**: Offers clean digital playback, minimizing jitter.
3. **Mercury Pegasus**: A quality DAC that provides transparent conversion.
4. **WA6 (Woo Audio 6)**: A tube amplifier known for warmth and rich harmonic
   textures, great for midrange bloom.
5. **ZMF Atticus**: Closed-back headphones with impactful bass and lush midrange.

### Recommended Tracks and What to Listen For:

1. **"Hotel California" by Eagles**
   - **Timestamp: 0:50** – Listen for the detail in the guitar work and vocal
     layering. The percussion should feel precise.
   - **Frequencies**: Focus on 2-5 kHz for vocal textures.

2. **"Bassically" by Tei Shi**
   - **Timestamp: 1:20** – Notice the deep, controlled bass and its impact,
     highlighting the ZMF Atticus' low-end capabilities paired with the tube amp.
   - **Frequencies**: The sub-bass around 60 Hz should be tight and defined.

3. **"So What" by Miles Davis**
   - **Timestamp: 0:30** – The timbre of the trumpet and subtle texture in
     the background reveal the DAC's transparency and the amp's midrange richness.

(5 tracks ready - use "play <n>" to play)

> p 2
Searching for: Tei Shi Bassically...
Playing: Bassically - Tei Shi, GianLuca Buccellati
```

Or get mood-based suggestions:

```
> suggest sad

Getting suggestions for "sad"...

1. **Adele - Someone Like You**
   - **Listen for:** The piano intro (0:00 to 0:20) offers a clean, high-resolution
     test for midrange clarity and decay.
   - **Audio characteristic:** Focus on the emotional weight in Adele's vocals
     and the piano's natural timbre.

2. **Radiohead - Exit Music (For a Film)**
   - **Listen for:** Thom Yorke's voice (0:30 to 1:10) showcasing dynamic range
     and subtlety.
   - **Audio characteristic:** Evaluates system's ability to reproduce emotional
     depth and quiet textures.

3. **Fleetwood Mac - Landslide**
   - **Listen for:** Acoustic guitar and vocal harmony (0:10 to 0:50).
   - **Audio characteristic:** Check for imaging and soundstage precision.

4. **Billie Eilish - When the Party's Over**
   - **Listen for:** Vocal layering and subtle background effects (0:50 to 1:20).
   - **Audio characteristic:** Reveals detail retrieval and spatial depth.

5. **Jeff Buckley - Hallelujah**
   - **Listen for:** The resonance of Buckley's voice and acoustic guitar (1:00 to 1:40).
   - **Audio characteristic:** Note how well your system handles emotional
     expression and harmonic richness.

(5 tracks ready - use "play <n>" to play)

> p 1
Searching for: Adele Someone Like You...
Playing: Someone Like You - Adele, Dan Wilson
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` with your OpenAI API key:
   ```
   OPENAI_API_KEY=sk-...
   CHAIN_DESCRIPTION=Your DAC -> Amp -> Speakers/Headphones
   ```

3. Run the POC:
   ```bash
   npm run poc
   ```

4. Authorize "Listening Lab POC" in Roon Settings → Extensions

## Commands

```
zones              List available zones
zone [n]           Select zone / show current
search <query>     Search for tracks (alias: s)
play [n]           Play from search/suggestions, or resume (alias: p)
queue <n>          Queue from search/suggestions
pause/stop/next    Playback controls
now                Show now playing

ask <question>     Ask the audio coach (alias: a)
suggest <mood>     Get track suggestions (playable with play <n>)
```

## Requirements

- Roon Core on your network
- OpenAI API key
- Node.js 18+
