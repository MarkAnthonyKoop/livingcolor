"""LivingColor backend — powered by Claude Code (user's subscription).

Thin Flask shell: static serving + blueprint registration. The actual logic
lives in core.py (helpers), ai_routes.py, motion_routes.py, archive_routes.py.
Gunicorn entry point stays `server.app:app`.
"""

import os
import sys

# Make `server.*` importable when run directly (python3 server/app.py) as well
# as under gunicorn from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from flask import Flask, send_from_directory  # noqa: E402

from server.ai_routes import ai_bp  # noqa: E402
from server.motion_routes import motion_bp  # noqa: E402
from server.archive_routes import archive_bp  # noqa: E402
from server.project_routes import project_bp  # noqa: E402

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')

app.register_blueprint(ai_bp)
app.register_blueprint(motion_bp)
app.register_blueprint(archive_bp)
app.register_blueprint(project_bp)


@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'index.html')


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8091))
    app.run(host='0.0.0.0', port=port, debug=True)
