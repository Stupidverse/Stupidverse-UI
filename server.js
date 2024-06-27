const fs = require('fs');
const https = require('https');
const express = require('express');
const vhost = require('vhost');
const path = require('path');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');

const dbPath = path.join(__dirname, 'database.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT UNIQUE,
      username TEXT UNIQUE,
      password TEXT,
      gameLevel TEXT
    )`,
    (err) => {
      if (err) {
        console.error('Error creating user table:', err.message);
      }
    }
  );

  db.run(
    `CREATE TABLE IF NOT EXISTS settings (
      setupCompleted BOOLEAN DEFAULT 0
    )`,
    (err) => {
      if (err) {
        console.error('Error creating settings table:', err.message);
      } else {
        db.get('SELECT COUNT(*) AS count FROM settings', (err, row) => {
          if (err) {
            console.error('Error checking settings table:', err.message);
          } else if (row.count === 0) {
            db.run('INSERT INTO settings (setupCompleted) VALUES (0)');
          }
        });
      }
    }
  );
});

const app = express();
app.use(
  session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: false,
  })
);
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
  db.get('SELECT setupCompleted FROM settings', (err, row) => {
    if (err) {
      console.error('Error retrieving setup status:', err.message);
      res.status(500).send('Error retrieving setup status.');
    } else if (!row || !row.setupCompleted) {
      if (req.path !== '/setup' && req.path !== '/setup/') {
        return res.redirect('/setup');
      }
    }
    next();
  });
});

function ensureLoggedIn(req, res, next) {
  if (!req.session.username) {
    return res.redirect('/login');
  }
  next();
}

app.get('/setup', (req, res) => {
  db.get('SELECT setupCompleted FROM settings', (err, row) => {
    if (err) {
      console.error('Error retrieving setup status:', err.message);
      res.status(500).send('Error retrieving setup status.');
    } else if (row && row.setupCompleted) {
      res.redirect('/login');
    } else {
      res.render('setup');
    }
  });
});

app.post('/setup', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const gameLevel = req.body.gameLevel;

  generateUniqueId((userId) => {
    if (!userId) {
      res.status(500).send('Error generating unique user ID.');
      return;
    }

    db.run(
      'INSERT INTO users (userId, username, password, gameLevel) VALUES (?, ?, ?, ?)',
      [userId, username, password, gameLevel],
      function (err) {
        if (err) {
          console.error('Error creating user:', err.message);
          res.status(500).send('Error creating user.');
        } else {
          db.run('UPDATE settings SET setupCompleted = 1', (err) => {
            if (err) {
              console.error('Error updating setup status:', err.message);
              res.status(500).send('Error updating setup status.');
            } else {
              req.session.username = username;
              req.session.userId = userId;
              res.redirect('/communities');
            }
          });
        }
      }
    );
  });
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.get('/user-settings', ensureLoggedIn, (req, res) => {
  res.render('user-settings', { username: req.session.username });
});

app.post('/login', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  db.get(
    'SELECT * FROM users WHERE username = ? AND password = ?',
    [username, password],
    (err, row) => {
      if (err) {
        console.error('Error logging in:', err.message);
        res.status(500).send('Error logging in.');
      } else if (row) {
        console.log(`User logged in successfully: ${username}`);
        req.session.username = username;
        req.session.userId = row.userId;
        res.redirect('/communities');
      } else {
        res.status(401).send('Invalid username or password.');
      }
    }
  );
});

app.get('/communities', ensureLoggedIn, (req, res) => {
  res.render('communities', { username: req.session.username });
});

app.get('/get-username', ensureLoggedIn, (req, res) => {
  res.json({ username: req.session.username });
});

app.get('/', (req, res) => {
  res.redirect('/communities');
});

function generateUniqueId(callback) {
  const userId = Math.floor(1000000 + Math.random() * 9000000).toString();

  db.get('SELECT userId FROM users WHERE userId = ?', [userId], (err, row) => {
    if (err) {
      console.error('Error checking user ID uniqueness:', err.message);
      callback(null);
    } else if (row) {
      generateUniqueId(callback);
    } else {
      callback(userId);
    }
  });
}

const portalApp = express();
portalApp.use(express.static(path.join(__dirname, 'public/portal')));
portalApp.set('view engine', 'ejs');
portalApp.set('views', path.join(__dirname, 'public/portal/views'));

const ctrApp = express();
ctrApp.use(express.static(path.join(__dirname, 'public/ctr')));
ctrApp.set('view engine', 'ejs');
ctrApp.set('views', path.join(__dirname, 'public/ctr/views'));

const offDeviceApp = express();
offDeviceApp.use(express.static(path.join(__dirname, 'public/web')));
offDeviceApp.set('view engine', 'ejs');
offDeviceApp.set('views', path.join(__dirname, 'public/web/views'));

app.use(vhost('portal.olv.localhost', portalApp));
app.use(vhost('ctr.olv.localhost', ctrApp));
app.use(vhost('localhost', offDeviceApp));

const privateKey = fs.readFileSync(
  path.join(__dirname, 'certs', 'key.pem'),
  'utf8'
);
const certificate = fs.readFileSync(
  path.join(__dirname, 'certs', 'cert.pem'),
  'utf8'
);

const credentials = {
  key: privateKey,
  cert: certificate,
  secureOptions:
    https.constants.SSL_OP_NO_TLSv1 |
    https.constants.SSL_OP_NO_TLSv1_1 |
    https.constants.SSL_OP_NO_SSLv2 |
    https.constants.SSL_OP_NO_SSLv3,
};

const PORT = process.env.PORT || 443;
const HOST = '0.0.0.0';

https.createServer(credentials, app).listen(PORT, HOST, () => {
  console.log(`Server is running on https://${HOST}:${PORT}`);
});
