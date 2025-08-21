// hashPassword.js
const bcrypt = require("bcryptjs");

(async () => {
  try {
    const hashed = await bcrypt.hash("12345", 10); // 12345 ko hash karna hai
    console.log("Your hashed password:", hashed);
  } catch (err) {
    console.error("Error:", err);
  }

  const bcrypt = require("bcryptjs");

(async () => {
  try {
    const hashed = await bcrypt.hash("user123", 10); // normal user ka password
    console.log("Hashed password:", hashed);
  } catch (err) {
    console.error("Error:", err);
  }
})();

  
})();
