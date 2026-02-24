require("dotenv").config();

const express = require("express");
const multer = require("multer");
const sqlite3 = require("sqlite3").verbose();
const { v4: uuidv4 } = require("uuid");
const dayjs = require("dayjs");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("view engine", "ejs");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ===== SUPABASE CONFIG =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ===== TEMP FOLDER =====
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
    created_at TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    file_path TEXT,
    version_number INTEGER,
    uploaded_at TEXT
  )`);
});

// ===== ROOT REDIRECT =====
app.get("/", (req, res) => {
  res.redirect("/admin");
});

// ===== DASHBOARD =====
app.get("/admin", (req, res) => {

  db.all(`
    SELECT o.*, 
    (SELECT file_path FROM versions 
     WHERE order_id = o.id 
     ORDER BY version_number DESC LIMIT 1) as latest_file,
    (SELECT MAX(version_number) FROM versions 
     WHERE order_id = o.id) as latest_version
    FROM orders o
    ORDER BY o.id DESC
  `, [], (err, orders) => {

    res.render("dashboard", { orders });
  });
});

// ===== CREATE ORDER =====
app.post("/admin/upload", upload.single("file"), async (req, res) => {

  if (!req.file) return res.send("No file uploaded");

  try {

    const fileName = `${Date.now()}-${req.file.originalname}`;

    const fileBuffer = fs.readFileSync(req.file.path);

    const { error } = await supabase.storage
      .from("pdf-files")
      .upload(fileName, fileBuffer, {
        contentType: "application/pdf"
      });

    fs.unlinkSync(req.file.path);

    if (error) {
      console.error(error);
      return res.send("Supabase upload error");
    }

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
          (order_id, file_path, version_number, uploaded_at)
          VALUES (?, ?, ?, ?)`,
          [
            orderId,
            fileName,
            1,
            dayjs().toISOString()
          ],
          () => res.redirect("/admin")
        );
      }
    );

  } catch (err) {
    console.error(err);
    res.send("Upload failed");
  }
});

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});