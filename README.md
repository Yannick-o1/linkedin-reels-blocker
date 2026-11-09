# Reels Blocker for LinkedIn

A Chrome extension that blocks LinkedIn's short-form "reels" video experience.

## What it blocks

| Toggle | Default | What it does |
| --- | --- | --- |
| Block the reels player | On | Closes the full-screen vertical video player (the one with up/down arrows) the moment it opens, and redirects video-feed URLs such as `/videos/` to your home feed. |
| Hide "Videos for you" | On | Removes the reels carousel from the feed. It also matches headings like "Recommended videos" and a few translations. |
| Hide the Video tab | On | Removes a video-feed link from the top navigation, if your account has one. |
| Hide every video post | Off | Strict mode: also hides ordinary posts that contain a video. |

LinkedIn Live and video events (`/video/live/…`, `/video/event/…`) are never blocked.

## Install

1. Get the code: either run `git clone https://github.com/Yannick-o1/linkedin-reels-blocker.git`, or click **Code → Download ZIP** on GitHub and unzip it.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `linkedin-reels-blocker` folder.
5. Pin the extension from the puzzle-piece menu if you want quick access to the toggles.
6. Reload any LinkedIn tabs that were already open.

## How it works

LinkedIn renames its CSS classes often, so the extension finds reels by how they look and behave rather than by class names:

- **Carousel:** a feed module whose heading reads "Videos for you" (or a similar phrase).
- **Player:** a dialog or full-screen overlay that holds a `<video>` and has next/previous-video controls, or that fills the screen. The extension clicks the overlay's close button. If that doesn't close it, it presses Escape. If the overlay is still open after that, the extension hides it.
- **Video tab:** a top-nav link to a video-feed path.

Text that people write themselves is ignored: posts, comments, messages and the post composer. A post that says "videos for you" won't be hidden.

## If something slips through

LinkedIn changes its UI often. If a reel gets past the extension, right-click it, choose **Inspect**, and look at the heading text or the buttons' `aria-label`s. Then add the new wording to `CAROUSEL_HEADING` or `PLAYER_NAV` at the top of `content.js`. Click the reload icon on the extension card in `chrome://extensions`, then refresh LinkedIn.

## License

[MIT](LICENSE)
