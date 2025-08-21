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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const ok = /image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Only image files are allowed"), ok);
  },
});

// Check room conflicts
const checkRoomConflict = async (room_id, booking_date, start_time, hours) => {
  console.log('Starting room conflict check:', { room_id, booking_date, start_time, hours });
  const sql = `
    SELECT * FROM room_bookings
    WHERE room_id = ? AND booking_date = ?
    AND (
      (start_time <= ? AND ADDTIME(start_time, SEC_TO_TIME(hours*3600)) > ?)
      OR
      (start_time < ADDTIME(?, SEC_TO_TIME(?*3600)) AND ADDTIME(start_time, SEC_TO_TIME(hours*3600)) >= ADDTIME(?, SEC_TO_TIME(?*3600)))
    )
  `;
  try {
    const [results] = await db.query(sql, [room_id, booking_date, start_time, start_time, start_time, hours, start_time, hours]);
    console.log('Room conflict check results:', results);
    return results.length > 0;
  } catch (err) {
    console.error('Room conflict check error:', err.message, err.sqlMessage);
    throw err;
  }
};

// Check vehicle conflicts
const checkVehicleConflict = async (vehicle_id, booking_date, start_time, hours) => {
  console.log('Starting vehicle conflict check:', { vehicle_id, booking_date, start_time, hours });
  const sql = `
    SELECT * FROM vehicle_bookings
    WHERE vehicle_id = ? AND booking_date = ?
    AND (
      (start_time <= ? AND ADDTIME(start_time, SEC_TO_TIME(hours*3600)) > ?)
      OR
      (start_time < ADDTIME(?, SEC_TO_TIME(?*3600)) AND ADDTIME(start_time, SEC_TO_TIME(hours*3600)) >= ADDTIME(?, SEC_TO_TIME(?*3600)))
    )
  `;
  try {
    const [results] = await db.query(sql, [vehicle_id, booking_date, start_time, start_time, start_time, hours, start_time, hours]);
    console.log('Vehicle conflict check results:', results);
    return results.length > 0;
  } catch (err) {
    console.error('Vehicle conflict check error:', err.message, err.sqlMessage);
    throw err;
  }
};

// GET all rooms
app.get("/rooms", async (req, res) => {
  try {
    console.log('Fetching rooms');
    const [results] = await db.query("SELECT * FROM rooms ORDER BY room_id DESC");
    const mapped = results.map((r) => ({
      ...r,
      photo_url: r.photo_url
        ? r.photo_url.startsWith("http")
          ? r.photo_url
          : `${req.protocol}://${req.get("host")}/uploads/${r.photo_url}`
        : null,
    }));
    res.json(mapped);
  } catch (err) {
    console.error('Rooms fetch error:', err.message, err.sqlMessage);
    res.status(500).json({ error: err.message });
  }
});

// POST /rooms
app.post("/rooms", upload.single("photo"), async (req, res) => {
  const { room_name, capacity } = req.body;
  let { photo_url } = req.body;

  if (!room_name || !capacity) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Missing room_name or capacity" });
  }

  if (req.file) {
    photo_url = req.file.filename;
  } else if (photo_url) {
    try {
      new URL(photo_url);
    } catch {
      // Not a valid URL → treat as filename
    }
  } else {
    photo_url = null;
  }

  try {
    const [result] = await db.query(
      "INSERT INTO rooms (room_name, capacity, photo_url) VALUES (?, ?, ?)",
      [room_name, parseInt(capacity, 10), photo_url]
    );

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
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('Room insert error:', err.message, err.sqlMessage);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /rooms/:id
app.delete("/rooms/:id", async (req, res) => {
  const roomId = req.params.id;

  try {
    const [rows] = await db.query("SELECT photo_url FROM rooms WHERE room_id = ?", [roomId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    const current = rows[0].photo_url;

    await db.query("DELETE FROM rooms WHERE room_id = ?", [roomId]);

    if (current && !current.startsWith("http")) {
      const filePath = path.join(__dirname, "Uploads", current);
      fs.unlink(filePath, () => {});
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Room delete error:', err.message, err.sqlMessage);
    res.status(500).json({ error: err.message });
  }
});

// Reserve room
app.post("/reserve_room", async (req, res) => {
  try {
    const { user_id, room_id, department_name, booking_date, start_time, hours } = req.body;
    console.log('Received room reservation request:', req.body);

    if (!user_id || !room_id || !department_name || !booking_date || !start_time || !hours) {
      console.log('Missing fields:', { user_id, room_id, department_name, booking_date, start_time, hours });
      return res.status(400).json({ error: "All required fields must be filled." });
    }

    // Validate hours
    if (!Number.isInteger(hours) || hours > 8 || hours < 1) {
      console.log('Invalid hours:', hours);
      return res.status(400).json({ error: "Duration must be an integer between 1 and 8 hours." });
    }

    // Validate booking_date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(booking_date)) {
      console.log('Invalid date format:', booking_date);
      return res.status(400).json({ error: "Booking date must be in YYYY-MM-DD format." });
    }

    // Validate start_time format (HH:MM or HH:MM:SS)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (!timeRegex.test(start_time)) {
      console.log('Invalid time format:', start_time);
      return res.status(400).json({ error: "Start time must be in HH:MM or HH:MM:SS format." });
    }

    // Normalize start_time to HH:MM:SS
    const normalizedStartTime = start_time.length === 5 ? `${start_time}:00` : start_time;

    // Validate user_id
    console.log('Checking user_id:', user_id);
    const [userResults] = await db.query('SELECT user_id FROM users WHERE user_id = ?', [user_id]);
    if (userResults.length === 0) {
      console.log('User not found:', user_id);
      return res.status(400).json({ error: `User with ID ${user_id} does not exist.` });
    }

    // Validate room_id
    console.log('Checking room_id:', room_id);
    const [roomResults] = await db.query('SELECT room_id FROM rooms WHERE room_id = ?', [room_id]);
    if (roomResults.length === 0) {
      console.log('Room not found:', room_id);
      return res.status(400).json({ error: `Room with ID ${room_id} does not exist.` });
    }

    // Check for conflicts
    console.log('Calling room conflict check');
    const hasConflict = await checkRoomConflict(room_id, booking_date, normalizedStartTime, hours);
    if (hasConflict) {
      console.log('Room conflict detected');
      return res.status(409).json({ error: "Room is already booked for this time." });
    }

    // Insert reservation
    console.log('Inserting room reservation:', { user_id, room_id, department_name, booking_date, start_time: normalizedStartTime, hours });
    const sqlInsert = `
      INSERT INTO room_bookings (user_id, room_id, department_name, booking_date, start_time, hours)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    const [result] = await db.query(sqlInsert, [user_id, room_id, department_name, booking_date, normalizedStartTime, hours]);
    console.log('Room reservation successful:', { booking_id: result.insertId });
    res.json({ 
      message: "Room reserved successfully!", 
      booking_id: result.insertId, 
      start_time: normalizedStartTime 
    });
  } catch (err) {
    console.error('Room reserve endpoint error:', err.message, err.sqlMessage);
    res.status(500).json({ error: `Room reserve error: ${err.message}${err.sqlMessage ? ' - ' + err.sqlMessage : ''}` });
  }
});

// GET all room reservations
app.get("/reservations_room", async (req, res) => {
  try {
    console.log('Fetching all room reservations');
    const sql = `
      SELECT rb.booking_id, rb.user_id, rb.room_id, rb.department_name, rb.booking_date,
             TIME_FORMAT(rb.start_time, '%H:%i') AS start_time, rb.hours,
             TIME_FORMAT(rb.end_time, '%H:%i') AS end_time
      FROM room_bookings rb
      ORDER BY rb.booking_date, rb.start_time
    `;
    const [results] = await db.query(sql);
    res.json(results);
  } catch (err) {
    console.error('Room reservations fetch error:', err.message, err.sqlMessage);
    res.status(500).json({ error: `Room reservations fetch error: ${err.message}${err.sqlMessage ? ' - ' + err.sqlMessage : ''}` });
  }
});

// GET all vehicles
app.get("/vehicles", async (req, res) => {
  try {
    console.log('Fetching vehicles');
    const [results] = await db.query("SELECT * FROM vehicles ORDER BY vehicle_id DESC");
    const mapped = results.map((v) => ({
      ...v,
      photo_url: v.photo_url
        ? v.photo_url.startsWith("http")
          ? v.photo_url
          : `${req.protocol}://${req.get("host")}/uploads/${v.photo_url}`
        : null,
    }));
    res.json(mapped);
  } catch (err) {
    console.error('Vehicles fetch error:', err.message, err.sqlMessage);
    res.status(500).json({ error: err.message });
  }
});

// POST /vehicles
app.post("/vehicles", upload.single("photo"), async (req, res) => {
  const { vehicle_type, car_name, driver_name, driver_phone } = req.body;
  let { photo_url } = req.body;

  if (!vehicle_type || !car_name || !driver_name || !driver_phone) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Missing vehicle_type, car_name, driver_name, or driver_phone" });
  }

  if (req.file) {
    photo_url = req.file.filename;
  } else if (photo_url) {
    try {
      new URL(photo_url);
    } catch {
      // Not a valid URL → treat as filename
    }
  } else {
    photo_url = null;
  }

  try {
    const [result] = await db.query(
      "INSERT INTO vehicles (vehicle_type, car_name, driver_name, driver_phone, photo_url) VALUES (?, ?, ?, ?, ?)",
      [vehicle_type, car_name, driver_name, driver_phone, photo_url]
    );

    const inserted = {
      vehicle_id: result.insertId,
      vehicle_type,
      car_name,
      driver_name,
      driver_phone,
      photo_url: photo_url
        ? (photo_url.startsWith("http")
            ? photo_url
            : `${req.protocol}://${req.get("host")}/uploads/${photo_url}`)
        : null,
    };

    res.json(inserted);
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    console.error('Vehicle insert error:', err.message, err.sqlMessage);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /vehicles/:id
app.delete("/vehicles/:id", async (req, res) => {
  const vehicleId = req.params.id;

  try {
    const [rows] = await db.query("SELECT photo_url FROM vehicles WHERE vehicle_id = ?", [vehicleId]);
    if (!rows.length) return res.status(404).json({ error: "Not found" });

    const current = rows[0].photo_url;

    await db.query("DELETE FROM vehicles WHERE vehicle_id = ?", [vehicleId]);

    if (current && !current.startsWith("http")) {
      const filePath = path.join(__dirname, "Uploads", current);
      fs.unlink(filePath, () => {});
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Vehicle delete error:', err.message, err.sqlMessage);
    res.status(500).json({ error: err.message });
  }
});

// Reserve vehicle
app.post("/reserve_vehicle", async (req, res) => {
  try {
    const { user_id, vehicle_id, department_name, booking_date, start_time, hours, destination } = req.body;
    console.log('Received vehicle reservation request:', req.body);

    if (!user_id || !vehicle_id || !department_name || !booking_date || !start_time || !hours || !destination) {
      console.log('Missing fields:', { user_id, vehicle_id, department_name, booking_date, start_time, hours, destination });
      return res.status(400).json({ error: "All required fields must be filled." });
    }

    // Validate hours
    if (!Number.isInteger(hours) || hours > 8 || hours < 1) {
      console.log('Invalid hours:', hours);
      return res.status(400).json({ error: "Duration must be an integer between 1 and 8 hours." });
    }

    // Validate booking_date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(booking_date)) {
      console.log('Invalid date format:', booking_date);
      return res.status(400).json({ error: "Booking date must be in YYYY-MM-DD format." });
    }

    // Validate start_time format (HH:MM or HH:MM:SS)
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (!timeRegex.test(start_time)) {
      console.log('Invalid time format:', start_time);
      return res.status(400).json({ error: "Start time must be in HH:MM or HH:MM:SS format." });
    }

    // Validate destination
    if (destination.trim() === '') {
      console.log('Invalid destination:', destination);
      return res.status(400).json({ error: "Destination cannot be empty." });
    }

    // Normalize start_time to HH:MM:SS
    const normalizedStartTime = start_time.length === 5 ? `${start_time}:00` : start_time;

    // Validate user_id
    console.log('Checking user_id:', user_id);
    const [userResults] = await db.query('SELECT user_id FROM users WHERE user_id = ?', [user_id]);
    if (userResults.length === 0) {
      console.log('User not found:', user_id);
      return res.status(400).json({ error: `User with ID ${user_id} does not exist.` });
    }

    // Validate vehicle_id
    console.log('Checking vehicle_id:', vehicle_id);
    const [vehicleResults] = await db.query('SELECT vehicle_id FROM vehicles WHERE vehicle_id = ?', [vehicle_id]);
    if (vehicleResults.length === 0) {
      console.log('Vehicle not found:', vehicle_id);
      return res.status(400).json({ error: `Vehicle with ID ${vehicle_id} does not exist.` });
    }

    // Check for conflicts
    console.log('Calling vehicle conflict check');
    const hasConflict = await checkVehicleConflict(vehicle_id, booking_date, normalizedStartTime, hours);
    if (hasConflict) {
      console.log('Vehicle conflict detected');
      return res.status(409).json({ error: "Vehicle is already booked for this time." });
    }

    // Insert reservation
    console.log('Inserting vehicle reservation:', { user_id, vehicle_id, department_name, booking_date, start_time: normalizedStartTime, hours, destination });
    const sqlInsert = `
      INSERT INTO vehicle_bookings (user_id, vehicle_id, department_name, booking_date, start_time, hours, destination)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await db.query(sqlInsert, [user_id, vehicle_id, department_name, booking_date, normalizedStartTime, hours, destination]);
    console.log('Vehicle reservation successful:', { booking_id: result.insertId });
    res.json({ 
      message: "Vehicle reserved successfully!", 
      booking_id: result.insertId, 
      start_time: normalizedStartTime 
    });
  } catch (err) {
    console.error('Vehicle reserve endpoint error:', err.message, err.sqlMessage);
    res.status(500).json({ error: `Vehicle reserve error: ${err.message}${err.sqlMessage ? ' - ' + err.sqlMessage : ''}` });
  }
});

// GET all vehicle reservations
app.get("/reservations_vehicle", async (req, res) => {
  try {
    console.log('Fetching all vehicle reservations');
    const sql = `
      SELECT vb.booking_id, vb.user_id, vb.vehicle_id, vb.department_name, vb.booking_date,
             TIME_FORMAT(vb.start_time, '%H:%i') AS start_time, vb.hours,
             TIME_FORMAT(vb.end_time, '%H:%i') AS end_time, vb.destination
      FROM vehicle_bookings vb
      ORDER BY vb.booking_date, vb.start_time
    `;
    const [results] = await db.query(sql);
    res.json(results);
  } catch (err) {
    console.error('Vehicle reservations fetch error:', err.message, err.sqlMessage);
    res.status(500).json({ error: `Vehicle reservations fetch error: ${err.message}${err.sqlMessage ? ' - ' + err.sqlMessage : ''}` });
  }
});


// ✅ Register Route
app.post("/register", async (req, res) => {
  try {
    let { full_name, email, password } = req.body;

    // Basic sanitation
    full_name = (full_name || "").trim();
    email = (email || "").trim().toLowerCase();
    password = (password || "").trim();

    if (!full_name || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    if (!email.endsWith("@alkhidmat.org")) {
      return res
        .status(400)
        .json({ error: "Only @alkhidmat.org emails are allowed" });
    }

    // Check if email exists (case-insensitive)
    const [rows] = await db.query(
      "SELECT user_id FROM users WHERE LOWER(email) = ?",
      [email]
    );
    if (rows.length > 0) {
      return res.status(400).json({ error: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.query(
      "INSERT INTO users (full_name, email, password, role_id) VALUES (?, ?, ?, ?)",
      [full_name, email, hashedPassword, 2] // default role_id = 2
    );

    return res
      .status(201)
      .json({ message: "User registered successfully", user_id: result.insertId });
  } catch (err) {
    console.error("❌ Register error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});

// ✅ Login Route
app.post("/login", async (req, res) => {
  try {
    let { email, password } = req.body;

    email = (email || "").trim().toLowerCase();
    password = (password || "").trim();

    if (!email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Grab exactly what we need
    const [rows] = await db.query(
      "SELECT user_id, full_name, email, password, role_id FROM users WHERE LOWER(email) = ?",
      [email]
    );
    if (rows.length === 0) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email, role_id: user.role_id },
      "secretkey", // ⚠️ put in process.env.JWT_SECRET for production
      { expiresIn: "1h" }
    );

    return res.json({
      message: "Login successful",
      token,
      user_id: user.user_id,
      full_name: user.full_name,
      email: user.email,
      role_id: user.role_id,
    });
  } catch (err) {
    console.error("❌ Login error:", err.message);
    return res.status(500).json({ error: "Server error" });
  }
});


const PORT = 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
