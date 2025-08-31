import express from "express";
import mysql from "mysql2/promise";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Fix __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ✅ MySQL Connection
let db;
async function connectDB() {
  try {
    db = await mysql.createConnection({
      host: "localhost",
      user: "root",
      password: "root",
      database: "alkhidmat_db",
    });
    console.log("✅ MySQL connected");
  } catch (err) {
    console.error("❌ DB Connection Error:", err.message);
  }
}
connectDB();

// Serve uploaded images statically
app.use("/uploads", express.static(path.join(__dirname, "Uploads")));

// Multer storage (unique filenames)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "Uploads")),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || "");
    cb(null, unique + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Only image files are allowed"), ok);
  },
});

// --------------------- CONFLICT CHECKS ---------------------

const checkRoomConflict = async (room_id, booking_date, start_time, hours) => {
  const sql = `
    SELECT * FROM room_bookings
    WHERE room_id=? AND booking_date=? 
      AND (
        (start_time <= ? AND ADDTIME(start_time, SEC_TO_TIME(hours*3600)) > ?)
        OR
        (start_time < ADDTIME(?, SEC_TO_TIME(?*3600)) AND ADDTIME(start_time, SEC_TO_TIME(hours*3600)) >= ADDTIME(?, SEC_TO_TIME(?*3600)))
      )
  `;
  const [results] = await db.query(sql, [
    room_id, booking_date,
    start_time, start_time,
    start_time, hours,
    start_time, hours
  ]);
  return results.length > 0;
};

const checkVehicleConflict = async (vehicle_id, booking_date, start_time, hours) => {
  const sql = `
    SELECT * FROM vehicle_bookings
    WHERE vehicle_id=? AND booking_date=? 
      AND (
        (start_time <= ? AND ADDTIME(start_time, SEC_TO_TIME(hours*3600)) > ?)
        OR
        (start_time < ADDTIME(?, SEC_TO_TIME(?*3600)) AND ADDTIME(start_time, SEC_TO_TIME(hours*3600)) >= ADDTIME(?, SEC_TO_TIME(?*3600)))
      )
  `;
  const [results] = await db.query(sql, [
    vehicle_id, booking_date,
    start_time, start_time,
    start_time, hours,
    start_time, hours
  ]);
  return results.length > 0;
};

// --------------------- ROOMS ---------------------

app.get("/rooms", async (req, res) => {
  try {
    const [results] = await db.query("SELECT * FROM rooms ORDER BY room_id DESC");
    const mapped = results.map(r => ({
      ...r,
      photo_url: r.photo_url
        ? r.photo_url.startsWith("http")
          ? r.photo_url
          : `${req.protocol}://${req.get("host")}/uploads/${r.photo_url}`
        : null
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/rooms", upload.single("photo"), async (req, res) => {
  const { room_name, capacity } = req.body;
  let photo_url = req.file ? req.file.filename : null;

  if (!room_name || !capacity) return res.status(400).json({ error: "Missing room_name or capacity" });

  try {
    const [result] = await db.query(
      "INSERT INTO rooms (room_name, capacity, photo_url) VALUES (?, ?, ?)",
      [room_name, parseInt(capacity, 10), photo_url]
    );

    res.json({
      room_id: result.insertId,
      room_name,
      capacity: parseInt(capacity, 10),
      photo_url: photo_url ? `${req.protocol}://${req.get("host")}/uploads/${photo_url}` : null
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.delete("/rooms/:id", async (req, res) => {
  const roomId = req.params.id;
  try {
    const [rows] = await db.query("SELECT photo_url FROM rooms WHERE room_id=?", [roomId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    await db.query("DELETE FROM rooms WHERE room_id=?", [roomId]);

    const current = rows[0].photo_url;
    if (current && !current.startsWith("http")) fs.unlink(path.join(__dirname, "Uploads", current), () => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reserve Room
app.post("/reserve_room", async (req, res) => {
  try {
    let { user_id, room_id, department_name, booking_date, start_time, hours } = req.body;
    if (!user_id || !room_id || !department_name || !booking_date || !start_time || !hours)
      return res.status(400).json({ error: "All fields required" });

    hours = parseInt(hours, 10);
    if (hours < 1 || hours > 8) return res.status(400).json({ error: "Hours must be 1-8" });

    const normalizedStartTime = start_time.length === 5 ? `${start_time}:00` : start_time;

    const [userCheck] = await db.query("SELECT user_id FROM users WHERE user_id=?", [user_id]);
    if (!userCheck.length) return res.status(400).json({ error: "User not found" });

    const [roomCheck] = await db.query("SELECT room_id FROM rooms WHERE room_id=?", [room_id]);
    if (!roomCheck.length) return res.status(400).json({ error: "Room not found" });

    const conflict = await checkRoomConflict(room_id, booking_date, normalizedStartTime, hours);
    if (conflict) return res.status(409).json({ error: "Room already booked" });

    const [result] = await db.query(
      "INSERT INTO room_bookings (user_id, room_id, department_name, booking_date, start_time, hours, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [user_id, room_id, department_name, booking_date, normalizedStartTime, hours, "Pending"]
    );

    res.json({ message: "Room reserved", booking_id: result.insertId, start_time: normalizedStartTime, status: "Pending" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/reservations_room", async (req, res) => {
  try {
    const sql = `
      SELECT rb.booking_id, rb.user_id, rb.room_id, rb.department_name, rb.booking_date,
             TIME_FORMAT(rb.start_time,'%H:%i') AS start_time,
             rb.hours, TIME_FORMAT(rb.end_time,'%H:%i') AS end_time, rb.status
      FROM room_bookings rb
      ORDER BY rb.booking_date, rb.start_time
    `;
    const [results] = await db.query(sql);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------- VEHICLES ---------------------

app.get("/vehicles", async (req, res) => {
  try {
    const [results] = await db.query("SELECT * FROM vehicles ORDER BY vehicle_id DESC");
    const mapped = results.map(v => ({
      ...v,
      photo_url: v.photo_url
        ? v.photo_url.startsWith("http")
          ? v.photo_url
          : `${req.protocol}://${req.get("host")}/uploads/${v.photo_url}`
        : null
    }));
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/vehicles", upload.single("photo"), async (req, res) => {
  const { vehicle_type, car_name, driver_name, driver_phone } = req.body;
  let photo_url = req.file ? req.file.filename : null;

  if (!vehicle_type || !car_name || !driver_name || !driver_phone)
    return res.status(400).json({ error: "Missing fields" });

  try {
    const [result] = await db.query(
      "INSERT INTO vehicles (vehicle_type, car_name, driver_name, driver_phone, photo_url) VALUES (?, ?, ?, ?, ?)",
      [vehicle_type, car_name, driver_name, driver_phone, photo_url]
    );

    res.json({
      vehicle_id: result.insertId,
      vehicle_type, car_name, driver_name, driver_phone,
      photo_url: photo_url ? `${req.protocol}://${req.get("host")}/uploads/${photo_url}` : null
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: err.message });
  }
});

app.delete("/vehicles/:id", async (req, res) => {
  const vehicleId = req.params.id;
  try {
    const [rows] = await db.query("SELECT photo_url FROM vehicles WHERE vehicle_id=?", [vehicleId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    await db.query("DELETE FROM vehicles WHERE vehicle_id=?", [vehicleId]);
    const current = rows[0].photo_url;
    if (current && !current.startsWith("http")) fs.unlink(path.join(__dirname, "Uploads", current), () => {});

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reserve Vehicle
app.post("/reserve_vehicle", async (req, res) => {
  try {
    let { user_id, vehicle_id, department_name, booking_date, start_time, hours, destination } = req.body;
    if (!user_id || !vehicle_id || !department_name || !booking_date || !start_time || !hours || !destination)
      return res.status(400).json({ error: "All fields required" });

    hours = parseInt(hours, 10);
    if (hours < 1 || hours > 8) return res.status(400).json({ error: "Hours must be 1-8" });

    const normalizedStartTime = start_time.length === 5 ? `${start_time}:00` : start_time;

    const [userCheck] = await db.query("SELECT user_id FROM users WHERE user_id=?", [user_id]);
    if (!userCheck.length) return res.status(400).json({ error: "User not found" });

    const [vehicleCheck] = await db.query("SELECT vehicle_id FROM vehicles WHERE vehicle_id=?", [vehicle_id]);
    if (!vehicleCheck.length) return res.status(400).json({ error: "Vehicle not found" });

    const conflict = await checkVehicleConflict(vehicle_id, booking_date, normalizedStartTime, hours);
    if (conflict) return res.status(409).json({ error: "Vehicle already booked" });

    const [result] = await db.query(
      "INSERT INTO vehicle_bookings (user_id, vehicle_id, department_name, booking_date, start_time, hours, destination, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [user_id, vehicle_id, department_name, booking_date, normalizedStartTime, hours, destination, "Pending"]
    );

    res.json({ message: "Vehicle reserved", booking_id: result.insertId, start_time: normalizedStartTime, status: "Pending" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/reservations_vehicle", async (req, res) => {
  try {
    const sql = `
      SELECT vb.booking_id, vb.user_id, vb.vehicle_id, vb.department_name, vb.booking_date,
             TIME_FORMAT(vb.start_time,'%H:%i') AS start_time,
             vb.hours, TIME_FORMAT(vb.end_time,'%H:%i') AS end_time, vb.destination, vb.status
      FROM vehicle_bookings vb
      ORDER BY vb.booking_date, vb.start_time
    `;
    const [results] = await db.query(sql);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --------------------- USERS ---------------------

app.post("/register", async (req, res) => {
  try {
    let { full_name, email, password } = req.body;
    full_name = (full_name || "").trim();
    email = (email || "").trim().toLowerCase();
    password = (password || "").trim();

    if (!full_name || !email || !password) return res.status(400).json({ error: "All fields required" });
    if (!email.endsWith("@alkhidmat.org")) return res.status(400).json({ error: "Only @alkhidmat.org allowed" });

    const [rows] = await db.query("SELECT user_id FROM users WHERE LOWER(email)=?", [email]);
    if (rows.length) return res.status(400).json({ error: "Email exists" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO users (full_name, email, password, role_id) VALUES (?, ?, ?, ?)",
      [full_name, email, hashedPassword, 2]
    );

    res.status(201).json({ message: "User registered", user_id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  try {
    let { email, password } = req.body;
    email = (email || "").trim().toLowerCase();
    password = (password || "").trim();

    if (!email || !password) return res.status(400).json({ error: "All fields required" });

    const [rows] = await db.query("SELECT user_id, full_name, email, password, role_id FROM users WHERE LOWER(email)=?", [email]);
    if (!rows.length) return res.status(400).json({ error: "Invalid credentials" });

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid credentials" });

    const token = jwt.sign({ user_id: user.user_id, email: user.email, role_id: user.role_id }, "secretkey", { expiresIn: "1h" });

    res.json({ message: "Login successful", token, user_id: user.user_id, full_name: user.full_name, email: user.email, role_id: user.role_id });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// --------------------- UPDATE STATUS ---------------------

app.patch("/update_room_status", async (req, res) => {
  try {
    const { booking_id, status } = req.body;
    if (!booking_id || !["Pending","Approved","Cancelled"].includes(status))
      return res.status(400).json({ error: "Invalid booking_id or status" });

    await db.query("UPDATE room_bookings SET status=? WHERE booking_id=?", [status, booking_id]);
    res.json({ message: "Room status updated" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/update_vehicle_status", async (req, res) => {
  try {
    const { booking_id, status } = req.body;
    if (!booking_id || !["Pending","Approved","Cancelled"].includes(status))
      return res.status(400).json({ error: "Invalid booking_id or status" });

    await db.query("UPDATE vehicle_bookings SET status=? WHERE booking_id=?", [status, booking_id]);
    res.json({ message: "Vehicle status updated" });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
