const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// MySQL connection
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "16092004",
  database: "alkhidmat_db"
});

db.connect(err => {
  if (err) console.error("❌ DB connection error:", err);
  else console.log("✅ Connected to DB");
});

// ------------------ REGISTER ------------------
app.post("/register", async (req, res) => {
  const { full_name, email, password } = req.body;

  if (!email.endsWith("@alkhidmat.org")) {
    return res.status(400).json({ error: "Only @alkhidmat.org emails are allowed" });
  }

  try {
    const [existing] = await db.promise().query("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length > 0) return res.status(400).json({ error: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.promise().query(
      "INSERT INTO users (full_name, email, password, role_id) VALUES (?, ?, ?, ?)",
      [full_name, email, hashedPassword, 2] // normal user role_id=2
    );

    res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------ LOGIN ------------------
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const [results] = await db.promise().query(
      `SELECT u.user_id, u.full_name, u.email, u.password, r.role_name 
       FROM users u 
       JOIN roles r ON u.role_id = r.role_id 
       WHERE u.email = ?`,
      [email]
    );

    if (results.length === 0) return res.status(400).json({ error: "Invalid email or password" });

    const user = results[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) return res.status(400).json({ error: "Invalid email or password" });

    res.json({
      message: "Login successful",
      user_id: user.user_id,
      full_name: user.full_name,
      role: user.role_name.toLowerCase() // admin / user
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ------------------ START SERVER ------------------
const PORT = 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));




