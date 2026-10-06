# Outside-tester validation (SM-2)

Goal: prove that a stranger can install Shotstash from the README alone and get to the moment that matters.

- **Target 1:** the first thumbnail appears in the library within **10 minutes** of starting.
- **Target 2:** a share link URL is copied within **15 minutes** of starting.

Three outside testers, each on their own machine. Results go in the table at the bottom, exactly as measured. Nothing is filled in until a real run happened.

## Who counts as a tester

- Has used Docker before, but has never seen Shotstash, its code or its docs.
- Not the maintainer and not someone who watched the maintainer install it.
- Runs **Linux on x64** with Docker Engine and the Compose plugin already installed (installing Docker is not part of the clock).
- Has about 2 GB of free memory and a free port 3005 (or knows how to pick another).

Where to find them: people who answered in an issue or discussion, friends in other self-hosting communities, a local meetup. Ask; never pay for a positive result.

## What they get

- The repository URL. Nothing else: no docs link, no hints, no chat with the maintainer during the run.
- One synthetic test video and one generated image to upload (for example made with `ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=30 -t 10 sample.mp4`), so nobody uses personal media.

## The run

1. Tester opens the repository page in a browser and starts a stopwatch.
2. Tester follows the README only. They may open links the README gives them.
3. **Stop 1:** the first thumbnail is visible in the library. Note the time.
4. Tester keeps going until a share link exists and its URL is on the clipboard.
5. **Stop 2:** the share URL is copied. Note the time.
6. Afterwards, a five-minute talk: where did you hesitate, what did you expect to see, what would you change in the README?

If a tester is stuck for more than five minutes on one step, note the step and help them past it; the run then counts as a miss for both targets, and the README gets fixed before the next tester.

## What to record

- Date, Shotstash version or commit, distribution and version, CPU, memory.
- Image pull or local build (pulled images are the launch-day path).
- Time to first thumbnail, time to share URL copied (minutes and seconds).
- Every place they hesitated, every error message they saw, and what they did about it.
- Their words, briefly. No names unless they want to be credited.

## Consent

Read this to every tester before starting: "I will write down the times and the problems you run into, without your name unless you want credit. You can stop at any time. Please use only the sample files I gave you."

## Results

| # | Date | Version | Platform | Pulled or built | First thumbnail | Share URL copied | Targets met | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |

## Outcome

- [ ] All three runs meet both targets, or the README was fixed and the failed runs repeated with new testers.
- [ ] README changes made from the findings are merged.
