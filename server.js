// server.js
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bodyParser = require("body-parser");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Serve uploaded images statically: http://localhost:5000/uploads/<filename>
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Multer storage (unique filenames)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || "");
    cb(null, unique + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Only image files are allowed"), ok);
  },
});

// ---- MySQL connection ----
const db = mysql.createConnection({
  host: "localhost",
  user: "root",                // <- change if needed
  password: "root",                // <- change if needed
  database: "alkhidmat_db", // <- change if needed
});

db.connect((err) => {
  if (err) {
    console.error("DB connection failed:", err);
    process.exit(1);
  }
  console.log("✅ Connected to MySQL");
});

// ---------------- API ROUTES ----------------

// GET all rooms
app.get("/rooms", (req, res) => {
  db.query("SELECT * FROM rooms ORDER BY room_id DESC", (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    // If photo_url is a local file (just filename), return full URL
    const mapped = results.map((r) => ({
      ...r,
      photo_url: r.photo_url
        ? r.photo_url.startsWith("http")
          ? r.photo_url
          : `${req.protocol}://${req.get("host")}/uploads/${r.photo_url}`
        : null,
    }));
    res.json(mapped);
  });
});

// POST /rooms (supports either file upload OR a photo_url string)
// Use multipart/form-data. Field names: room_name, capacity, photo (file), photo_url (string)
app.post("/rooms", upload.single("photo"), (req, res) => {
  const { room_name, capacity } = req.body;
  let { photo_url } = req.body;

  if (!room_name || !capacity) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Missing room_name or capacity" });
  }

  // If a file was uploaded, use its filename instead of the URL
  if (req.file) {
    photo_url = req.file.filename; // stored locally in /uploads
  } else if (photo_url) {
    // if it's a full URL, keep as-is; if it's something like 'my.jpg', store just filename
    try {
      // If it's a valid URL, keep it. If this fails, treat as filename and store filename only.
      new URL(photo_url);
      // keep full URL string
    } catch {
      // Not a valid URL string -> treat as filename; we don't copy files for URL case.
    }
  } else {
    photo_url = null;
  }

  db.query(
    "INSERT INTO rooms (room_name, capacity, photo_url) VALUES (?, ?, ?)",
    [room_name, parseInt(capacity, 10), photo_url],
    (err, result) => {
      if (err) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: err.message });
      }

      const inserted = {
        room_id: result.insertId,
        room_name,
        capacity: parseInt(capacity, 10),
        photo_url: photo_url
          ? (photo_url.startsWith("http")
              ? photo_url
              : `${req.protocol}://${req.get("host")}/uploads/${photo_url}`)
          : null,
      };

      res.json(inserted);
    }
  );
});

// DELETE /rooms/:id  (also deletes local image file if it was a local upload)
app.delete("/rooms/:id", (req, res) => {
  const roomId = req.params.id;

  // First get current photo_url to know if it's a local file
  db.query(
    "SELECT photo_url FROM rooms WHERE room_id = ?",
    [roomId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(404).json({ error: "Not found" });

      const current = rows[0].photo_url;

      db.query("DELETE FROM rooms WHERE room_id = ?", [roomId], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });

        // If photo_url is a **local filename** (not http), remove file
        if (current && !current.startsWith("http")) {
          const filePath = path.join(__dirname, "uploads", current);
          fs.unlink(filePath, () => {}); // ignore errors
        }
        res.json({ success: true });
      });
    }
  );
});

const PORT = 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
