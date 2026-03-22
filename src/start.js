// Combined starter: runs both API and SMTP in the same process
// This is critical because they share an in-memory SQLite database (sql.js)

import './index.js';
import './smtp-server.js';
