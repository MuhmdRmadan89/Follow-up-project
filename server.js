require("dotenv").config();

const express = require("express");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const dayjs = require("dayjs");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");

const app = express();
const PORT = 3000;

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ====== DEBUG ENV ======
console.log("Cloud Name:", process.env.CLOUDINARY_CLOUD_NAME);
console.log("API Key:", process.env.CLOUDINARY_API_KEY);

// ====== CLOUDINARY CONFIG ======
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ====== TEMP FOLDER ======
if (!fs.existsSync("temp")) {
  fs.mkdirSync("temp");
}

const upload = multer({ dest: "temp/" });

const db = new sqlite3.Database("database.db");

db.serialize(() => {

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT,
    client_phone TEXT,
    token TEXT,
    token_expiry TEXT,
    status TEXT DEFAULT 'Sent',
    has_new_feedback INTEGER DEFAULT 0,
    created_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    file_url TEXT,
    version_number INTEGER,
    uploaded_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    message TEXT,
    created_at TEXT
  )`);
});

// ===== DASHBOARD =====
app.get("/admin", (req, res) => {

  db.all(`
    SELECT o.*, 
    (SELECT file_url FROM versions 
     WHERE order_id = o.id 
     ORDER BY version_number DESC LIMIT 1) as latest_file,
    (SELECT MAX(version_number) FROM versions 
     WHERE order_id = o.id) as latest_version
    FROM orders o
    ORDER BY o.id DESC
  `, [], (err, orders) => {

    db.all("SELECT * FROM feedback", [], (err2, feedbacks) => {

      const grouped = {};
      feedbacks.forEach(f => {
        if (!grouped[f.order_id]) grouped[f.order_id] = [];
        grouped[f.order_id].push(f);
      });

      orders.forEach(o => {
        o.feedbacks = grouped[o.id] || [];
      });

      res.render("dashboard", { orders });
    });
  });
});

// ===== CREATE ORDER =====
app.post("/admin/upload", upload.single("file"), async (req, res) => {

  if (!req.file) return res.send("No file uploaded");

  try {

    const result = await cloudinary.uploader.upload(req.file.path, {
      resource_type: "auto"
    });

    fs.unlinkSync(req.file.path); // remove temp file

    const token = uuidv4();
    const expiry = dayjs().add(7, "day").toISOString();

    db.run(
      `INSERT INTO orders 
      (client_name, client_phone, token, token_expiry, created_at)
      VALUES (?, ?, ?, ?, ?)`,
      [
        req.body.client_name,
        req.body.client_phone,
        token,
        expiry,
        dayjs().toISOString()
      ],
      function () {

        const orderId = this.lastID;

        db.run(
          `INSERT INTO versions 
          (order_id, file_url, version_number, uploaded_at)
          VALUES (?, ?, ?, ?)`,
          [
            orderId,
            result.secure_url,
            1,
            dayjs().toISOString()
          ],
          () => res.redirect("/admin")
        );
      }
    );

  } catch (err) {
    console.error("CLOUDINARY ERROR:", err);
    res.send("Cloudinary ERROR: " + JSON.stringify(err));
  }
});

// ===== START SERVER =====
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});