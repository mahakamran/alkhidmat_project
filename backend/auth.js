document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const full_name = e.target[0].value;
  const email = e.target[1].value;
  const password = e.target[2].value;

  const res = await fetch("http://localhost:3000/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name, email, password }),
  });

  const data = await res.json();
  if (res.ok) {
    alert(data.message);
    window.location.href = "login.html";
  } else {
    alert(data.error);
  }

});
