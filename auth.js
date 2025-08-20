document.addEventListener("DOMContentLoaded", () => {

  // ------------------ REGISTER ------------------
  const registerForm = document.getElementById("registerForm");
  if (registerForm) {
    registerForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const full_name = registerForm.querySelector('input[type="text"]').value.trim();
      const email = registerForm.querySelector('input[type="email"]').value.trim();
      const password = registerForm.querySelector('input[type="password"]').value.trim();

      try {
        const res = await fetch("http://localhost:3000/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ full_name, email, password })
        });
        const data = await res.json();
        if (res.ok) {
          alert("Registration successful! You can now login.");
          window.location.href = "login.html";
        } else {
          alert(data.error);
        }
      } catch (err) {
        alert("Server error: " + err.message);
      }
    });
  }

  // ------------------ LOGIN ------------------
  const loginBtn = document.getElementById("login-btn");
  if (loginBtn) {
    loginBtn.addEventListener("click", async () => {
  const email = document.getElementById("email-input").value.trim();
  const password = document.getElementById("pass-input").value.trim();
  const errorMsg = document.getElementById("error-msg");

  try {
    const res = await fetch("http://localhost:3000/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

  if (res.ok) {
  // Save session
  localStorage.setItem("isLoggedIn", "true");
  localStorage.setItem("userFullName", data.full_name);
  localStorage.setItem("userRole", data.role.toLowerCase()); // ✅ Lowercase important

  // Redirect based on role
  if (data.role.toLowerCase() === "admin") {
  window.location.href = "admin.html";
} else {
  window.location.href = "home.html";
}

} else {
  errorMsg.innerText = data.error;
  errorMsg.style.display = "block";
}


  } catch (err) {
    errorMsg.innerText = "Server error: " + err.message;
    errorMsg.style.display = "block";
  }
});

  }

  // ------------------ LOGOUT ------------------
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("userFullName");
      localStorage.removeItem("userRole");
      window.location.href = "login.html";
    });
  }

  // ------------------ PROTECT PAGES ------------------
 // ------------------ Protect Page ------------------
window.protectPage = function(requiredRole) {
    const isLoggedIn = localStorage.getItem("isLoggedIn");
    const role = localStorage.getItem("userRole"); // stored in lowercase

    if (!isLoggedIn) {
        window.location.href = "login.html"; // login nahi hua
    } else if (requiredRole && role !== requiredRole.toLowerCase()) {
        // Agar page ka role match nahi karta
        if(role === "admin") {
            window.location.href = "admin.html";
        } else {
            window.location.href = "home.html";
        }
    }
}





// ------------------ Logout Function ------------------
function logout() {
  localStorage.clear();
  window.location.href = "login.html";
}


});
