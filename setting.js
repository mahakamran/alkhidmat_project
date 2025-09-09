

  window.onload = () => {
    const userData = JSON.parse(localStorage.getItem('userData'));
    if (userData) {
      document.getElementById('name').value = userData.name;
      document.getElementById('email').value = userData.email;
      document.getElementById('password').value = userData.password;
      document.getElementById('confirm').value = userData.password;
    } else {
      document.getElementById('name').value = "Syed Usman";
      document.getElementById('email').value = "Usman123@gmail.com";
      document.getElementById('password').value = "Usmna-9876";
      document.getElementById('confirm').value = "Usmna-9876";
    }

    const savedImage = localStorage.getItem('profileImage');
    if (savedImage) {
      document.getElementById('profileImage').src = savedImage;
      document.getElementById('accToggle').src = savedImage; // ✅ sync navbar image
    }
  };

  function resetForm() {
    const fields = ['name', 'email', 'password', 'confirm'];
    fields.forEach(id => {
      const input = document.getElementById(id);
      input.removeAttribute('readonly');
      input.value = '';
    });
  }

  function submitForm() {
    const name = document.getElementById('name');
    const email = document.getElementById('email');
    const password = document.getElementById('password');
    const confirm = document.getElementById('confirm');

    if (!name.value.trim() || !email.value.trim() || !password.value.trim() || !confirm.value.trim()) {
      alert('Please fill in all fields!');
      return;
    }

    if (password.value !== confirm.value) {
      alert('Passwords do not match!');
      return;
    }

    const userData = {
      name: name.value.trim(),
      email: email.value.trim(),
      password: password.value.trim()
    };
    localStorage.setItem('userData', JSON.stringify(userData));

    [name, email, password, confirm].forEach(input => {
      input.setAttribute('readonly', true);
    });

    alert('✅ Account updated and saved!');
  }

  // Profile image upload logic (sync both images)
  const imageUpload = document.getElementById('imageUpload');
  const profileImage = document.getElementById('profileImage');
  const accToggle = document.getElementById('accToggle'); // ✅ navbar image reference

  imageUpload.addEventListener('change', function () {
    const file = this.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const imgData = e.target.result;
        profileImage.src = imgData;
        accToggle.src = imgData; // ✅ update navbar image
        localStorage.setItem('profileImage', imgData);
      };
      reader.readAsDataURL(file);
    }
  });

   // Account dropdown (works for both desktop + mobile)

  const accDropdown = document.getElementById("accDropdown");

  accToggle.addEventListener("click", (e) => {
    e.stopPropagation(); // prevent immediate close
    accDropdown.classList.toggle("show");
  });

  window.addEventListener("click", function(e) {
    if (!accToggle.contains(e.target) && !accDropdown.contains(e.target)) {
      accDropdown.classList.remove("show");
    }
  });

  // Sidebar toggle
  const openMenu = document.getElementById("open-menu");
  const closeSidebar = document.getElementById("closeSidebar");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");

  openMenu.addEventListener("click", () => {
    sidebar.classList.add("show");
    overlay.classList.add("active");
  });
  closeSidebar.addEventListener("click", () => {
    sidebar.classList.remove("show");
    overlay.classList.remove("active");
  });
  overlay.addEventListener("click", () => {
    sidebar.classList.remove("show");
    overlay.classList.remove("active");
  });
