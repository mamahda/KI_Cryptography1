"""Starts the API server:  python run.py"""

import sys

from app import create_app
from app.config import ConfigError

if __name__ == "__main__":
    try:
        app = create_app()
    except ConfigError as e:
        sys.exit(f"config error: {e}")
    cfg = app.config["VAULT"]
    print(f"Vault API on http://{cfg.host}:{cfg.port}  (storage: {app.extensions['vault_storage'].root})")
    app.run(host=cfg.host, port=cfg.port, threaded=True)
