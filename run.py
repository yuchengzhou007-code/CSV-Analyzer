import argparse
import functools
import http.server
import shutil
import sys
import threading
import webbrowser
from pathlib import Path


if sys.version_info < (3, 10):
    raise SystemExit('Python 3.10 or newer is required.')

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'scripts'))
from import_analysis_matrix import main as process_matrix


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description='Silicon Lab: one analysis_1.csv input, process and launch locally.')
    parser.add_argument('--input', type=Path, default=ROOT / 'analysis_1.csv')
    parser.add_argument('--output', type=Path, default=ROOT / 'runtime')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--prepare-only', action='store_true')
    arguments = parser.parse_args()
    source = arguments.input.expanduser().resolve()
    output = arguments.output.expanduser().resolve()
    if not source.is_file():
        parser.error(f'Input CSV not found: {source}')
    if not 0 <= arguments.port <= 65535:
        parser.error('--port must be between 0 and 65535')
    if source.is_relative_to(output):
        parser.error('Keep the input CSV outside the generated output directory.')
    web = output / 'web'
    try:
        web.mkdir(parents=True, exist_ok=True)
        for asset in (ROOT / 'platform' / 'dist').iterdir():
            if asset.is_file() and asset.suffix in ('.html', '.css', '.js'):
                shutil.copy2(asset, web / asset.name)
        process_matrix(source, output / 'processed', web / 'data.json')
    except (ValueError, OSError, KeyError, ArithmeticError) as error:
        print(f'Processing failed: {error}', file=sys.stderr)
        print('Check the CSV format and units in USER_GUIDE.md.', file=sys.stderr)
        return 1
    print(f'Results: {output / "processed"}', flush=True)
    if arguments.prepare_only:
        return 0
    try:
        server = http.server.ThreadingHTTPServer(('127.0.0.1', arguments.port), functools.partial(Handler, directory=str(web)))
    except OSError as error:
        print(f'Cannot start local server: {error}\nTry: python3 run.py --port 8766', file=sys.stderr)
        return 1
    url = f'http://127.0.0.1:{server.server_address[1]}/'
    print(f'Open: {url}\nKeep this terminal open. Press Ctrl+C to stop.\nAfter replacing the CSV, restart this script to process the new data.', flush=True)
    if not arguments.no_browser:
        timer = threading.Timer(0.5, lambda: webbrowser.open(url)); timer.daemon = True; timer.start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
