const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const bcrypt = require('bcrypt');
require('dotenv').config();

// Set the path for the SQLite database file
const dbPath = path.join(__dirname, 'database.db');

// Connect to SQLite3 database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

// Create user table if not exists and settings table
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

// Set up session middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

app.set('view engine', 'ejs');

// Set paths for the different views
app.set('views', path.join(__dirname, 'public'));

// Middleware to parse the body of POST requests
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to check setup completion
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

// Middleware to ensure user is logged in
function ensureLoggedIn(req, res, next) {
  if (!req.session.username) {
    return res.redirect('/login');
  }
  next();
}

// Middleware to handle subdomains
app.use((req, res, next) => {
  const host = req.headers.host;
  if (host.startsWith('portal.')) {
    req.subdomain = 'portal';
  } else if (host.startsWith('ctr.')) {
    req.subdomain = 'ctr';
  } else if (host.startsWith('web.') || host === 'localhost') {
    req.subdomain = 'web';
  } else {
    req.subdomain = null;
  }
  next();
});

// Route handlers
app.get('/', (req, res) => {
  if (req.subdomain === 'portal') {
    res.render('portal/views/communities');
  } else if (req.subdomain === 'ctr') {
    res.render('ctr/views/ctr');
  } else if (req.subdomain === 'web') {
    res.render('web/views/web');
  } else {
    res.redirect('/communities');
  }
});

// Serve the setup page
app.get('/setup', (req, res) => {
  db.get('SELECT setupCompleted FROM settings', (err, row) => {
    if (err) {
      console.error('Error retrieving setup status:', err.message);
      res.status(500).send('Error retrieving setup status.');
    } else if (row && row.setupCompleted) {
      res.redirect('/login'); // If setup is already completed, redirect to login
    } else {
      res.render('portal/views/setup');
    }
  });
});

app.post('/setup', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;
  const gameLevel = req.body.gameLevel;

  // Generate a unique 7-digit random ID for the user
  generateUniqueId((userId) => {
    if (!userId) {
      res.status(500).send('Error generating unique user ID.');
      return;
    }

    // Hash the password before storing it
    bcrypt.hash(password, 10, (err, hash) => {
      if (err) {
        console.error('Error hashing password:', err.message);
        res.status(500).send('Error creating user.');
      } else {
        // Insert the user into the database
        db.run(
          'INSERT INTO users (userId, username, password, gameLevel) VALUES (?, ?, ?, ?)',
          [userId, username, hash, gameLevel],
          function (err) {
            if (err) {
              console.error('Error creating user:', err.message);
              res.status(500).send('Error creating user.');
            } else {
              // Update the setupCompleted flag in the settings table
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
      }
    });
  });
});

// Serve the login page
app.get('/login', (req, res) => {
  res.render('portal/views/login');
});

app.post('/login', (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  // Check if user exists in the database
  db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
    if (err) {
      console.error('Error logging in:', err.message);
      res.status(500).send('Error logging in.');
    } else if (row) {
      // Compare the provided password with the hashed password
      bcrypt.compare(password, row.password, (err, result) => {
        if (err) {
          console.error('Error comparing password:', err.message);
          res.status(500).send('Error logging in.');
        } else if (result) {
          // User logged in successfully
          console.log(`User logged in successfully: ${username}`);
          // Store the username in a session variable
          req.session.username = username;
          req.session.userId = row.userId;
          // Redirect to /communities after successful login
          res.redirect('/communities');
        } else {
          res.status(401).send('Invalid username or password.');
        }
      });
    } else {
      res.status(401).send('Invalid username or password.');
    }
  });
});

// Serve the communities page
app.get('/communities', ensureLoggedIn, (req, res) => {
  res.render('portal/views/communities', { username: req.session.username });
});

// Endpoint to get the username of the logged-in user
app.get('/get-username', ensureLoggedIn, (req, res) => {
  res.json({ username: req.session.username });
});

const PORT = process.env.PORT || 80;
const HOST = '0.0.0.0'; // Listen on all network interfaces
app.listen(PORT, HOST, () => {
  console.log(`Portal server is running on http://${HOST}:${PORT}`);
});

// Function to generate a unique 7-digit random ID
function generateUniqueId(callback) {
  const userId = Math.floor(1000000 + Math.random() * 9000000).toString();

  db.get('SELECT userId FROM users WHERE userId = ?', [userId], (err, row) => {
    if (err) {
      console.error('Error checking user ID uniqueness:', err.message);
      callback(null);
    } else if (row) {
      // If the ID already exists, generate a new one
      generateUniqueId(callback);
    } else {
      // If the ID is unique, return it
      callback(userId);
    }
  });
}
