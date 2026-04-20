from pathlib import Path
import textwrap

from playwright.sync_api import sync_playwright


ROOT = Path("/home/saverm/GPTLaTeXCopy")
TEST_URL = "https://chatgpt.com/c/test-timeline"
OUT_DIR = ROOT / "tmp" / "timeline-test-output"
OUT_DIR.mkdir(parents=True, exist_ok=True)

HTML = textwrap.dedent(
    """
    <!doctype html>
    <html class="light">
      <head>
        <meta charset="utf-8" />
        <title>Timeline Render Test</title>
        <style>
          html, body {
            margin: 0;
            padding: 0;
            min-height: 100%;
            background: #f7f7f8;
            color: #111827;
            font-family: sans-serif;
          }
          .page-shell {
            min-height: 2200px;
            padding: 32px 120px 220px 32px;
          }
          .flex.flex-col.text-sm.pb-25 {
            display: flex;
            flex-direction: column;
            gap: 28px;
          }
          [data-turn-id] {
            border-radius: 18px;
            padding: 20px 24px;
            background: white;
            box-shadow: 0 2px 10px rgba(0,0,0,.06);
          }
          [data-message-author-role="user"] {
            font-weight: 700;
            margin-bottom: 8px;
          }
          [data-message-author-role="assistant"] {
            line-height: 1.65;
          }
        </style>
      </head>
      <body>
        <div class="page-shell">
          <div class="flex flex-col text-sm pb-25">
            <div data-turn-id="u1" data-turn="user"><div data-message-author-role="user">User 1</div><div>Question 1</div></div>
            <div data-turn-id="a1" data-turn="assistant"><div data-message-author-role="assistant">Answer 1</div></div>
            <div data-turn-id="u2" data-turn="user"><div data-message-author-role="user">User 2</div><div>Question 2</div></div>
            <div data-turn-id="a2" data-turn="assistant"><div data-message-author-role="assistant">Answer 2</div></div>
            <div data-turn-id="u3" data-turn="user"><div data-message-author-role="user">User 3</div><div>Question 3</div></div>
            <div data-turn-id="a3" data-turn="assistant"><div data-message-author-role="assistant">Answer 3</div></div>
            <div data-turn-id="u4" data-turn="user"><div data-message-author-role="user">User 4</div><div>Question 4</div></div>
            <div data-turn-id="a4" data-turn="assistant"><div data-message-author-role="assistant">Answer 4</div></div>
          </div>
        </div>
      </body>
    </html>
    """
).strip()

CHROME_STUB = textwrap.dedent(
    """
    (() => {
      const listeners = [];
      const storageData = { chatgptTimelineEnabled: true };
      const api = {
        storage: {
          local: {
            get(defaults, callback) {
              const out = defaults && typeof defaults === 'object'
                ? { ...defaults, ...storageData }
                : { ...storageData };
              if (typeof callback === 'function') {
                callback(out);
                return;
              }
              return Promise.resolve(out);
            },
            set(values, callback) {
              Object.assign(storageData, values || {});
              const changes = {};
              for (const [key, value] of Object.entries(values || {})) {
                changes[key] = { newValue: value };
              }
              listeners.forEach((listener) => {
                try { listener(changes, 'local'); } catch {}
              });
              if (typeof callback === 'function') callback();
              return Promise.resolve();
            }
          },
          onChanged: {
            addListener(listener) { listeners.push(listener); }
          }
        }
      };
      Object.defineProperty(window, 'chrome', {
        configurable: true,
        value: api
      });
      localStorage.setItem('chatgptTimelineDebugInit', '1');
    })();
    """
).strip()


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.on("console", lambda msg: print(f"console[{msg.type}]: {msg.text}"))
        page.route(
            "**/c/test-timeline",
            lambda route: route.fulfill(
                status=200,
                content_type="text/html; charset=utf-8",
                body=HTML,
            ),
        )

        page.add_init_script(CHROME_STUB)
        page.add_init_script(path=str(ROOT / "shared" / "shared.js"))
        page.add_init_script(path=str(ROOT / "content" / "timeline.js"))
        page.goto(TEST_URL, wait_until="domcontentloaded")
        page.add_style_tag(path=str(ROOT / "content" / "timeline.css"))
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1200)

        state = page.evaluate(
            """
            () => {
              const bar = document.querySelector('.chatgpt-timeline-bar');
              const dots = Array.from(document.querySelectorAll('.timeline-dot'));
              const slider = document.querySelector('.timeline-left-slider');
              const barStyle = bar ? getComputedStyle(bar) : null;
              const dotStyle = dots[0] ? getComputedStyle(dots[0]) : null;
              return {
                hasBar: !!bar,
                barRect: bar ? bar.getBoundingClientRect().toJSON() : null,
                barStyle: barStyle ? {
                  display: barStyle.display,
                  visibility: barStyle.visibility,
                  opacity: barStyle.opacity,
                  zIndex: barStyle.zIndex,
                  pointerEvents: barStyle.pointerEvents,
                  backgroundColor: barStyle.backgroundColor
                } : null,
                dotCount: dots.length,
                firstDotRect: dots[0] ? dots[0].getBoundingClientRect().toJSON() : null,
                firstDotStyle: dotStyle ? {
                  display: dotStyle.display,
                  visibility: dotStyle.visibility,
                  opacity: dotStyle.opacity,
                  top: dotStyle.top,
                  left: dotStyle.left
                } : null,
                sliderRect: slider ? slider.getBoundingClientRect().toJSON() : null,
                bodyScrollHeight: document.body.scrollHeight,
                documentScrollHeight: document.documentElement.scrollHeight
              };
            }
            """
        )

        page.screenshot(path=str(OUT_DIR / "timeline-render.png"), full_page=False)
        print(state)
        browser.close()


if __name__ == "__main__":
    main()
