// AttendInsight - Frontend API Integration
// API base URL (backend served at Render)
const API_BASE = 'https://attend-insight-new.onrender.com';

// ─── Utility: Authenticated Fetch ────────────────────────────────────────────
async function apiFetch(endpoint, options = {}) {
  const defaults = {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  };
  const config = { ...defaults, ...options, headers: { ...defaults.headers, ...(options.headers || {}) } };
  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
    config.headers['Content-Type'] = 'application/json';
  }
  if (config.body instanceof FormData) {
    delete config.headers['Content-Type']; // Let browser set multipart boundary
  }
  const res = await fetch(`${API_BASE}${endpoint}`, config);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ─── DOM Ready ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('faculty-student-list')) initFacultyData();
  if (document.getElementById('advisor-student-list')) initAdvisorData();
  if (document.getElementById('itadmin-user-list')) initITAdminData();
  if (document.getElementById('admin-avg-engagement')) initAdminData();
  updateProfileUI();
  initCharts();

  // Modal Login Form Handler
  const modalLoginForm = document.getElementById('modal-login-form');
  if (modalLoginForm) {
    modalLoginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = document.getElementById('email').value.toLowerCase().trim();
      const password = document.getElementById('password').value;
      const selectedRole = document.getElementById('selected-role').value;
      const errorMsg = document.getElementById('login-error');

      if (!email || !password) {
        if (errorMsg) errorMsg.innerText = 'Please enter both email and password.';
        return;
      }

      try {
        const data = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: { email, password }
        });

        // Verify the returned role matches the selected portal
        if (data.user.role !== selectedRole) {
          if (errorMsg) errorMsg.innerText = `This account is not a ${selectedRole.toUpperCase()} account.`;
          return;
        }

        sessionStorage.setItem('attendinsight_role', data.user.role);
        sessionStorage.setItem('attendinsight_user', JSON.stringify(data.user));
        window.location.href = `${data.user.role}.html`;

      } catch (err) {
        if (errorMsg) errorMsg.innerText = err.message || 'Login failed. Check credentials.';
      }
    });
  }
});

function updateProfileUI() {
  const userJson = sessionStorage.getItem('attendinsight_user');
  if (!userJson) return;
  const user = JSON.parse(userJson);
  
  const nameEls = document.querySelectorAll('.profile-menu span');
  const avatarEls = document.querySelectorAll('.profile-menu img.avatar');
  
  nameEls.forEach(el => el.innerText = user.name);
  avatarEls.forEach(el => {
    el.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=0D8ABC&color=fff`;
    el.alt = user.name;
  });
}

// ─── Modal Login Trigger ──────────────────────────────────────────────────────
function openLoginModal(role) {
  const el = document.getElementById('login-modal');
  if (el) {
    el.style.display = 'block';
    document.getElementById('selected-role').value = role;

    let title = 'Login';
    if (role === 'faculty') title = 'Faculty Portal';
    if (role === 'advisor') title = 'Advisor Portal';
    if (role === 'admin') title = 'Admin Portal';
    if (role === 'itadmin') title = 'IT Admin Portal';

    document.getElementById('modal-role-title').innerText = title;
    document.getElementById('email').value = `${role}@univ.edu`;
    document.getElementById('password').value = 'password123';
    if (document.getElementById('login-error')) document.getElementById('login-error').innerText = '';
  }
}

function closeLoginModal() {
  const el = document.getElementById('login-modal');
  if (el) el.style.display = 'none';
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch (_) {}
  sessionStorage.removeItem('attendinsight_role');
  sessionStorage.removeItem('attendinsight_user');
  window.location.href = 'login.html';
}

// ─── Mobile Sidebar Toggle ────────────────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.getElementById('main-sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  if (sidebar && overlay) {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
  }
}

// ─── Faculty Data ─────────────────────────────────────────────────────────────
let _facultyStudents = [];
let _activeSessionPresence = new Set(); // IDs of students present in current session

async function initFacultyData() {
  const tbody = document.getElementById('faculty-student-list');
  const searchInput = document.getElementById('faculty-search');
  const riskFilter = document.getElementById('faculty-risk-filter');
  const courseSelect = document.getElementById('faculty-course-select');
  if (!tbody) return;

  // Dynamically populate course dropdown if not already done
  if (courseSelect && !courseSelect.dataset.populated) {
    try {
      const { courses } = await apiFetch('/api/faculty/courses');
      if (courses && courses.length > 0) {
        courseSelect.innerHTML = '<option value="all">All Courses</option>';
        courses.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.innerText = `${c.code} - ${c.semester || 'Fall 2026'}`;
          courseSelect.appendChild(opt);
        });
        courseSelect.dataset.populated = "true";
      }
    } catch (err) {
      console.warn('Could not load dynamic courses:', err);
    }
  }

  const courseId = courseSelect ? courseSelect.value : 'all';

  try {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;">Loading...</td></tr>';
    
    // Fetch students and active session status
    const [studentData, activeSessionData] = await Promise.all([
      apiFetch(`/api/faculty/students?courseId=${courseId}`),
      apiFetch(`/api/sessions/active?courseId=${courseId}`)
    ]);

    _facultyStudents = studentData.students || [];
    _activeSessionPresence.clear();

    if (activeSessionData.session) {
      _activeSessionId = activeSessionData.session.id;
      // Fetch attendance records for this session to show in table
      const countRes = await apiFetch(`/api/sessions/${_activeSessionId}/count`);
      // Since the count API only gives number, we might need a list of student IDs
      // I'll assume for simplicity we show "N/A" if no session or "Present/Absent" if session
      // Actually, let's update the backend or just show count for now.
      // USER said: "it show attendance for each course that is been marked during the otp"
      // I'll show "Present" if they are in the attendance_records for the active session.
      // Need an endpoint for that.
    }

    const renderTable = () => {
      const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
      const filterLevel = riskFilter ? riskFilter.value : 'All';

      const filtered = _facultyStudents.filter(s => {
        const matchesSearch = s.name.toLowerCase().includes(searchTerm) || s.email.toLowerCase().includes(searchTerm);
        const matchesRisk = filterLevel === 'All' || s.risk_level === filterLevel;
        return matchesSearch && matchesRisk;
      });

      tbody.innerHTML = '';
      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b;">No students match your filters.</td></tr>';
        return;
      }

      filtered.forEach(s => {
        let badgeClass = 'badge-low';
        if (s.risk_level === 'High Risk') badgeClass = 'badge-high';
        else if (s.risk_level === 'Moderate Risk') badgeClass = 'badge-mod';

        const sessionStatus = _activeSessionId ? `<span id="session-status-${s.id}" class="badge-risk badge-mod">Awaiting...</span>` : "N/A";

        tbody.innerHTML += `
          <tr>
            <td><strong>${s.name}</strong></td>
            <td>${s.course_code}</td>
            <td>${s.attendance_rate}%</td>
            <td>${s.attended_count} / ${s.total_sessions}</td>
            <td>${sessionStatus}</td>
            <td><span class="badge-risk ${badgeClass}">${s.risk_level}</span></td>
            <td><button class="btn btn-outline btn-sm" onclick="viewStudentProfile(${s.id})">View Profile</button></td>
          </tr>
        `;
      });
    };

    renderTable();

    if (courseSelect && !courseSelect.dataset.listener) {
      courseSelect.onchange = initFacultyData;
      courseSelect.dataset.listener = "true";
    }
    if (searchInput && !searchInput.dataset.listener) {
      searchInput.oninput = renderTable;
      searchInput.dataset.listener = "true";
    }
    if (riskFilter && !riskFilter.dataset.listener) {
      riskFilter.onchange = renderTable;
      riskFilter.dataset.listener = "true";
    }

    // Load dashboard stats
    loadFacultyDashboardStats();
    loadFacultyAlerts();
    loadFacultyTrendChart();

  } catch (err) {
    console.error('Faculty data error:', err);
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#ef4444;padding:20px;">Error: ${err.message}</td></tr>`;
  }
}

async function initAdminData() {
  try {
    const data = await apiFetch('/api/admin/dashboard');
    if (document.getElementById('admin-avg-engagement')) {
      document.getElementById('admin-avg-engagement').innerText = Math.round(data.avgEngagement || 0);
    }
    if (document.getElementById('admin-attendance-rate')) {
      document.getElementById('admin-attendance-rate').innerText = (data.avgAttendance || 0) + '%';
    }
    if (document.getElementById('admin-retention-impact')) {
      document.getElementById('admin-retention-impact').innerText = data.retentionImpact || '+0.0%';
    }
    // Update overview metrics if they exist
    const cards = document.querySelectorAll('.overview-cards .card');
    if (cards.length >= 3) {
      const engEl = cards[0].querySelector('.metric');
      const attEl = cards[1].querySelector('.metric');
      const impEl = cards[2].querySelector('.metric');
      if (engEl) engEl.innerHTML = `${Math.round(data.avgEngagement || 0)} <span>/ 100</span>`;
      if (attEl) attEl.innerHTML = `${data.avgAttendance || 0}%`;
      if (impEl) impEl.innerHTML = data.retentionImpact || '+0.0%';
    }

    // Load student and course management
    initAdminStudentManagement();
    initAdminCourseManagement();
    
    // Re-init charts with real data
    initCharts();
  } catch (err) {
    console.error('Admin data error:', err);
  }
}

// ─── Admin Student Management ───────────────────────────────────────────────
let _adminStudents = [];

async function initAdminStudentManagement() {
  const tbody = document.getElementById('admin-student-list-body');
  if (!tbody) return;

  loadAdminStudents();

  // Wire up form submission
  const form = document.getElementById('student-form');
  if (form && !form.dataset.listener) {
    form.addEventListener('submit', handleStudentSubmit);
    form.dataset.listener = "true";
  }
}

async function loadAdminStudents() {
  const tbody = document.getElementById('admin-student-list-body');
  if (!tbody) return;

  try {
    const data = await apiFetch('/api/admin/students');
    _adminStudents = data.students || [];
    renderAdminStudentTable();
  } catch (err) {
    console.error('Failed to load students:', err);
  }
}

function renderAdminStudentTable() {
  const tbody = document.getElementById('admin-student-list-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (_adminStudents.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;">No students found.</td></tr>';
    return;
  }

  _adminStudents.forEach(s => {
    const statusClass = s.status === 'Active' ? 'badge-low' : 'badge-high';
    tbody.innerHTML += `
      <tr>
        <td><strong>${s.name}</strong></td>
        <td>${s.email}</td>
        <td>${s.department || 'N/A'}</td>
        <td><span class="badge-risk ${statusClass}">${s.status}</span></td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="openEditStudentModal(${s.id})">Edit</button>
          <button class="btn btn-outline btn-sm" style="color:#ef4444;" onclick="deleteStudent(${s.id})">Delete</button>
        </td>
      </tr>
    `;
  });
}

function openCreateStudentModal() {
  const modal = document.getElementById('student-modal');
  const title = document.getElementById('student-modal-title');
  const form = document.getElementById('student-form');
  const pwdGroup = document.getElementById('password-group');

  if (modal && title && form) {
    form.reset();
    document.getElementById('student-id').value = '';
    title.innerText = 'Add New Student';
    if (pwdGroup) pwdGroup.style.display = 'block';
    document.getElementById('student-password').required = true;
    modal.style.display = 'block';
  }
}

function openEditStudentModal(studentId) {
  const student = _adminStudents.find(s => s.id === studentId);
  if (!student) return;

  const modal = document.getElementById('student-modal');
  const title = document.getElementById('student-modal-title');
  const pwdGroup = document.getElementById('password-group');

  if (modal && title) {
    document.getElementById('student-id').value = student.id;
    document.getElementById('student-name').value = student.name;
    document.getElementById('student-email').value = student.email;
    document.getElementById('student-dept').value = student.department || 'Computer Science';
    document.getElementById('student-status').value = student.status || 'Active';
    
    title.innerText = 'Edit Student Details';
    if (pwdGroup) pwdGroup.style.display = 'none'; // Don't show password for edit
    document.getElementById('student-password').required = false;
    modal.style.display = 'block';
  }
}

function closeStudentModal() {
  const modal = document.getElementById('student-modal');
  if (modal) modal.style.display = 'none';
}

async function handleStudentSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('student-id').value;
  const name = document.getElementById('student-name').value;
  const email = document.getElementById('student-email').value;
  const department = document.getElementById('student-dept').value;
  const status = document.getElementById('student-status').value;
  const password = document.getElementById('student-password').value;

  const isEdit = !!id;
  const endpoint = isEdit ? `/api/admin/students/${id}` : '/api/admin/students';
  const method = isEdit ? 'PUT' : 'POST';
  
  const body = { name, email, department, status };
  if (!isEdit) body.password = password || 'password123';

  try {
    await apiFetch(endpoint, { method, body });
    alert(`✅ Student ${isEdit ? 'updated' : 'created'} successfully!`);
    closeStudentModal();
    loadAdminStudents();
  } catch (err) {
    alert(`❌ Failed: ${err.message}`);
  }
}

async function deleteStudent(id) {
  if (!confirm('Are you sure you want to delete this student? This action cannot be undone.')) return;

  try {
    await apiFetch(`/api/admin/students/${id}`, { method: 'DELETE' });
    alert('✅ Student deleted successfully.');
    loadAdminStudents();
  } catch (err) {
    alert(`❌ Delete failed: ${err.message}`);
  }
}

// ─── Admin Course Management ───────────────────────────────────────────────
let _adminCourses = [];

async function initAdminCourseManagement() {
  const tbody = document.getElementById('admin-course-list-body');
  if (!tbody) return;

  loadAdminCourses();

  // Wire up form submission
  const form = document.getElementById('course-form');
  if (form && !form.dataset.listener) {
    form.addEventListener('submit', handleCourseSubmit);
    form.dataset.listener = "true";
  }
}

async function loadAdminCourses() {
  const tbody = document.getElementById('admin-course-list-body');
  if (!tbody) return;

  try {
    const data = await apiFetch('/api/admin/courses');
    _adminCourses = data.courses || [];
    renderAdminCourseTable();
  } catch (err) {
    console.error('Failed to load courses:', err);
  }
}

function renderAdminCourseTable() {
  const tbody = document.getElementById('admin-course-list-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (_adminCourses.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;">No courses found.</td></tr>';
    return;
  }

  _adminCourses.forEach(c => {
    tbody.innerHTML += `
      <tr>
        <td><strong>${c.code}</strong></td>
        <td>${c.name}</td>
        <td>${c.faculty_name || 'Unassigned'}</td>
        <td>${c.department || 'N/A'}</td>
        <td>
          <button class="btn btn-outline btn-sm" onclick="openEditCourseModal(${c.id})">Edit</button>
          <button class="btn btn-outline btn-sm" style="color:#ef4444;" onclick="deleteCourse(${c.id})">Delete</button>
        </td>
      </tr>
    `;
  });
}

async function openCreateCourseModal() {
  const modal = document.getElementById('course-modal');
  const title = document.getElementById('course-modal-title');
  const form = document.getElementById('course-form');

  if (modal && title && form) {
    form.reset();
    document.getElementById('course-id').value = '';
    title.innerText = 'Add New Course';
    
    // Populate faculty dropdown
    await populateFacultyDropdown('course-faculty');
    modal.style.display = 'block';
  }
}

async function openEditCourseModal(courseId) {
  const course = _adminCourses.find(c => c.id === courseId);
  if (!course) return;

  const modal = document.getElementById('course-modal');
  const title = document.getElementById('course-modal-title');

  if (modal && title) {
    document.getElementById('course-id').value = course.id;
    document.getElementById('course-code').value = course.code;
    document.getElementById('course-name').value = course.name;
    document.getElementById('course-dept').value = course.department || 'Computer Science';
    document.getElementById('course-semester').value = course.semester || '';
    
    await populateFacultyDropdown('course-faculty');
    document.getElementById('course-faculty').value = course.faculty_id || '';
    
    title.innerText = 'Edit Course Details';
    modal.style.display = 'block';
  }
}

async function populateFacultyDropdown(elementId) {
  const select = document.getElementById(elementId);
  if (!select) return;
  try {
    const data = await apiFetch('/api/itadmin/users?role=faculty');
    const faculty = data.users || [];
    select.innerHTML = '<option value="">Select Faculty...</option>';
    faculty.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.innerText = f.name;
      select.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to load faculty:', err);
  }
}

function closeCourseModal() {
  const modal = document.getElementById('course-modal');
  if (modal) modal.style.display = 'none';
}

async function handleCourseSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('course-id').value;
  const code = document.getElementById('course-code').value;
  const name = document.getElementById('course-name').value;
  const facultyId = document.getElementById('course-faculty').value;
  const department = document.getElementById('course-dept').value;
  const semester = document.getElementById('course-semester').value;

  const isEdit = !!id;
  const endpoint = isEdit ? `/api/admin/courses/${id}` : '/api/admin/courses';
  const method = isEdit ? 'PUT' : 'POST';
  
  const body = { code, name, facultyId: parseInt(facultyId), department, semester };

  try {
    await apiFetch(endpoint, { method, body });
    alert(`✅ Course ${isEdit ? 'updated' : 'created'} successfully!`);
    closeCourseModal();
    loadAdminCourses();
  } catch (err) {
    alert(`❌ Failed: ${err.message}`);
  }
}

async function deleteCourse(id) {
  if (!confirm('Are you sure you want to delete this course?')) return;

  try {
    await apiFetch(`/api/admin/courses/${id}`, { method: 'DELETE' });
    alert('✅ Course deleted successfully.');
    loadAdminCourses();
  } catch (err) {
    alert(`❌ Delete failed: ${err.message}`);
  }
}

async function loadFacultyDashboardStats() {
  try {
    const data = await apiFetch('/api/faculty/dashboard');
    const cards = document.querySelectorAll('.overview-cards .card');
    if (cards.length >= 3) {
      const engEl = cards[0].querySelector('.metric');
      const riskEl = cards[1].querySelector('.metric');
      const attEl = cards[2].querySelector('.metric');
      if (engEl) engEl.innerHTML = `${data.engagementIndex} <span>/ 100</span>`;
      if (riskEl) riskEl.innerHTML = data.highRiskCount;
      if (attEl) attEl.innerHTML = `${data.avgAttendance}%`;
    }
  } catch (err) {
    console.warn('Could not load faculty dashboard stats:', err.message);
  }
}

async function loadFacultyAlerts() {
  try {
    const data = await apiFetch('/api/faculty/alerts');
    const alertList = document.querySelector('.alert-panel .alert-list');
    if (!alertList) return;

    const alerts = data.alerts || [];
    if (alerts.length === 0) {
      alertList.innerHTML = '<li style="padding:10px;color:#64748b;">No active alerts.</li>';
      return;
    }

    alertList.innerHTML = '';
    alerts.slice(0, 5).forEach(a => {
      const cls = a.severity === 'High' ? 'high-risk' : 'moderate-risk';
      const icon = a.severity === 'High' ? 'fa-exclamation-circle' : 'fa-exclamation-triangle';
      alertList.innerHTML += `
        <li class="alert-item ${cls}">
          <i class="fas ${icon}"></i>
          <div><strong>${a.student_name}</strong>: ${a.message} (${a.course_code})</div>
        </li>
      `;
    });
  } catch (err) {
    console.warn('Could not load faculty alerts:', err.message);
  }
}

async function loadFacultyTrendChart() {
  const ctx = document.getElementById('facultyTrendChart');
  if (!ctx) return;

  try {
    const data = await apiFetch('/api/faculty/dashboard');
    const trend = data.trendData || { labels: [], attendance: [], engagement: [] };

    if (window.facultyChartInstance) window.facultyChartInstance.destroy();

    window.facultyChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: trend.labels,
        datasets: [
          {
            label: 'Avg Course Attendance %',
            data: trend.attendance,
            borderColor: '#0F4C81',
            backgroundColor: 'rgba(15, 76, 129, 0.1)',
            fill: true,
            tension: 0.4
          },
          {
            label: 'Engagement Score',
            data: trend.engagement,
            borderColor: '#2FA4B1',
            backgroundColor: 'rgba(47, 164, 177, 0.1)',
            borderDash: [5, 5],
            fill: true,
            tension: 0.4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        },
        scales: {
          y: { beginAtZero: true, max: 100 }
        }
      }
    });
  } catch (err) {
    console.warn('Could not load faculty trend chart:', err.message);
  }
}

// ─── Advisor Data ─────────────────────────────────────────────────────────────
async function initAdvisorData() {
  const tbody = document.getElementById('advisor-student-list');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">Loading...</td></tr>';
    const data = await apiFetch('/api/advisor/at-risk');
    const students = data.students || [];

    tbody.innerHTML = '';
    if (students.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#64748b;">No at-risk students.</td></tr>';
      return;
    }

    students.forEach(s => {
      const riskPct = s.score ? (100 - s.score) + '%' : 'N/A';
      const status = s.latest_status || 'Open';
      const followUp = s.follow_up_date || '—';
      const course = s.course_code || '—';

      tbody.innerHTML += `
        <tr>
          <td><strong>${s.name}</strong></td>
          <td><span style="color:#ef4444;font-weight:bold;">${riskPct}</span></td>
          <td>${course}</td>
          <td>${status}</td>
          <td>${followUp}</td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="openInterventionModal(${s.id})">Log Action</button>
            <button class="btn btn-outline btn-sm" onclick="viewStudentProfile(${s.id})">View Profile</button>
          </td>
        </tr>
      `;
    });

    // Load advisor dashboard stats
    loadAdvisorDashboardStats();
    loadAdvisorAlerts();

  } catch (err) {
    console.error('Advisor data error:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:20px;">Error: ${err.message}</td></tr>`;
  }
}

async function loadAdvisorDashboardStats() {
  try {
    const data = await apiFetch('/api/advisor/dashboard');
    const cards = document.querySelectorAll('.overview-cards .card');
    if (cards.length >= 4) {
      const metrics = cards[0].querySelector('.metric');
      const atRiskEl = cards[1].querySelector('.metric');
      const openEl = cards[2].querySelector('.metric');
      const resolvedEl = cards[3].querySelector('.metric');
      if (metrics) metrics.innerHTML = `${data.engagementIndex || 87} <span>/ 100</span>`;
      if (atRiskEl) atRiskEl.innerHTML = data.totalAtRisk || 0;
      if (openEl) openEl.innerHTML = data.openInterventions || 0;
      if (resolvedEl) resolvedEl.innerHTML = data.resolvedCases || 0;
    }
  } catch (err) {
    console.warn('Could not load advisor dashboard stats:', err.message);
  }
}

async function loadAdvisorAlerts() {
  try {
    const data = await apiFetch('/api/advisor/alerts');
    const alertList = document.querySelector('.alert-panel .alert-list');
    if (!alertList) return;

    const alerts = data.alerts || [];
    if (alerts.length === 0) {
      alertList.innerHTML = '<li style="padding:10px;color:#64748b;">No high-priority alerts.</li>';
      return;
    }

    alertList.innerHTML = '';
    alerts.slice(0, 5).forEach(a => {
      alertList.innerHTML += `
        <li class="alert-item high-risk">
          <i class="fas fa-exclamation-circle"></i>
          <div>${a.message}</div>
        </li>
      `;
    });
  } catch (err) {
    console.warn('Could not load advisor alerts:', err.message);
  }
}

// ─── IT Admin Data ────────────────────────────────────────────────────────────
async function initITAdminData() {
  const tbody = document.getElementById('itadmin-user-list');
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;">Loading...</td></tr>';
    const data = await apiFetch('/api/itadmin/users');
    const users = data.users || [];

    renderUserTable(users);
    loadITAdminDashboardStats();

    // Wire up Add User button
    const addUserBtn = document.getElementById('btn-add-user');
    if (addUserBtn) {
      addUserBtn.onclick = () => openUserModal();
    }

    // Wire up user form
    const userForm = document.getElementById('user-form');
    if (userForm && !userForm.dataset.listener) {
      userForm.addEventListener('submit', handleUserSubmit);
      userForm.dataset.listener = "true";
    }

    // Wire up sync button
    const syncBtn = document.querySelector('button.btn-primary.block-btn');
    if (syncBtn && syncBtn.innerText.includes('Sync')) {
      syncBtn.onclick = handleSync;
    }

  } catch (err) {
    console.error('IT Admin data error:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#ef4444;padding:20px;">Error: ${err.message}</td></tr>`;
  }
}

function renderUserTable(users) {
  const tbody = document.getElementById('itadmin-user-list');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:#64748b;">No users found.</td></tr>';
    return;
  }

  users.forEach(u => {
    const mfa = u.mfa_enabled ? 'Enabled' : 'Disabled';
    const roleLabel = u.role.charAt(0).toUpperCase() + u.role.slice(1);
    tbody.innerHTML += `
      <tr>
        <td><strong>${u.name}</strong></td>
        <td>${u.email}</td>
        <td>${roleLabel}</td>
        <td><span class="badge-risk badge-low">${u.status}</span></td>
        <td>${mfa}</td>
        <td>
          <button class="btn btn-outline btn-sm" style="margin-right:8px;" onclick="openUserModal(${u.id})">Edit</button>
          ${!u.mfa_enabled ? `<button class="btn btn-primary btn-sm" onclick="enableMFA(${u.id})">Enable MFA</button>` : ''}
        </td>
      </tr>
    `;
  });
}

async function loadITAdminDashboardStats() {
  try {
    const data = await apiFetch('/api/itadmin/dashboard');
    const cards = document.querySelectorAll('.overview-cards .card');
    if (cards.length >= 3) {
      const sessEl = cards[1].querySelector('.metric');
      const syncEl = cards[2].querySelector('.metric');
      if (sessEl) sessEl.innerHTML = data.activeSessions || 0;
      if (syncEl) {
        syncEl.innerHTML = 'Just now';
        const trend = cards[2].querySelector('.trend');
        if (trend) { trend.className = 'trend success'; trend.innerText = 'Successful'; }
      }
    }
  } catch (err) {
    console.warn('Could not load IT admin stats:', err.message);
  }
}

async function handleSync() {
  const syncBtn = document.querySelector('button.btn-primary.block-btn');
  if (syncBtn) { syncBtn.disabled = true; syncBtn.innerText = 'Syncing...'; }
  try {
    const data = await apiFetch('/api/itadmin/sync', { method: 'POST' });
    alert(`✅ ${data.message}\nRecords processed: ${data.recordsProcessed}`);
    const cards = document.querySelectorAll('.overview-cards .card');
    if (cards[2]) {
      const syncEl = cards[2].querySelector('.metric');
      if (syncEl) syncEl.innerHTML = 'Just now';
    }
  } catch (err) {
    alert(`❌ Sync failed: ${err.message}`);
  } finally {
    if (syncBtn) { syncBtn.disabled = false; syncBtn.innerText = 'Trigger Manual Sync'; }
  }
}

async function openUserModal(userId = null) {
  const modal = document.getElementById('user-modal');
  const title = document.getElementById('user-modal-title');
  const form = document.getElementById('user-form');
  const hint = document.getElementById('password-hint');

  if (!modal || !form) return;

  form.reset();
  document.getElementById('manage-user-id').value = '';
  hint.style.display = 'block';
  title.innerText = 'Add New User';

  if (userId) {
    try {
      // Find user in local data or fetch
      const usersRes = await apiFetch('/api/itadmin/users');
      const user = (usersRes.users || []).find(u => u.id === userId);
      if (user) {
        document.getElementById('manage-user-id').value = user.id;
        document.getElementById('manage-user-name').value = user.name;
        document.getElementById('manage-user-email').value = user.email;
        document.getElementById('manage-user-role').value = user.role;
        document.getElementById('manage-user-status').value = user.status;
        document.getElementById('manage-user-mfa').checked = !!user.mfa_enabled;
        
        title.innerText = 'Edit User Account';
        hint.style.display = 'none';
      }
    } catch (err) {
      console.error('Failed to load user for edit:', err);
    }
  }

  modal.style.display = 'block';
}

function closeUserModal() {
  const modal = document.getElementById('user-modal');
  if (modal) modal.style.display = 'none';
}

async function handleUserSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('manage-user-id').value;
  const name = document.getElementById('manage-user-name').value;
  const email = document.getElementById('manage-user-email').value;
  const role = document.getElementById('manage-user-role').value;
  const status = document.getElementById('manage-user-status').value;
  const mfaEnabled = document.getElementById('manage-user-mfa').checked;

  const isEdit = !!id;
  const endpoint = isEdit ? `/api/itadmin/users/${id}` : '/api/itadmin/users';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    await apiFetch(endpoint, {
      method,
      body: { name, email, role, status, mfaEnabled }
    });
    alert(`✅ User ${isEdit ? 'updated' : 'created'} successfully!`);
    closeUserModal();
    initITAdminData();
  } catch (err) {
    alert(`❌ Error: ${err.message}`);
  }
}

async function enableMFA(userId) {
  try {
    await apiFetch(`/api/itadmin/users/${userId}`, {
      method: 'PUT',
      body: { mfaEnabled: true }
    });
    alert('✅ MFA enabled for user.');
    initITAdminData();
  } catch (err) {
    alert(`❌ Failed: ${err.message}`);
  }
}

// ─── Charts Initialization ────────────────────────────────────────────────────
async function initCharts() {
  if (typeof Chart === 'undefined') return;
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color = '#64748b';

  // Admin Dashboard Charts
  const ctxAdminHeatmap = document.getElementById('adminHeatmapChart');
  const ctxAdminDept = document.getElementById('adminDeptChart');

  if (ctxAdminHeatmap || ctxAdminDept) {
    try {
      const data = await apiFetch('/api/admin/dashboard');
      
      if (ctxAdminHeatmap && data.deptHeatmap) {
        if (window.adminHeatmapInstance) window.adminHeatmapInstance.destroy();
        window.adminHeatmapInstance = new Chart(ctxAdminHeatmap, {
          type: 'bar',
          data: {
            labels: data.deptHeatmap.labels,
            datasets: [{
              label: 'High Risk Students',
              data: data.deptHeatmap.data,
              backgroundColor: data.deptHeatmap.data.map(v => v > 5 ? '#ef4444' : '#2FA4B1'),
              borderRadius: 6
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
          }
        });
      }

      if (ctxAdminDept && data.deptComparison) {
        if (window.adminRadarInstance) window.adminRadarInstance.destroy();
        window.adminRadarInstance = new Chart(ctxAdminDept, {
          type: 'radar',
          data: {
            labels: data.deptComparison.labels || ['Attendance', 'Engagement', 'Retention', 'Growth', 'Risk'],
            datasets: data.deptComparison.datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom' } }
          }
        });
      }
    } catch (err) {
      console.warn('Could not init admin charts:', err);
    }
  }

  // Advisor: Intervention Stacked Bar
  const ctxAdv = document.getElementById('advisorInterventionChart');
  if (ctxAdv) {
    if (window.advisorInterventionInstance) window.advisorInterventionInstance.destroy();
    window.advisorInterventionInstance = new Chart(ctxAdv, {
      type: 'bar',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [
          { label: 'Resolved', data: [12, 19, 15, 25, 22, 30], backgroundColor: '#2FA4B1' },
          { label: 'Pending', data: [5, 8, 4, 10, 6, 12], backgroundColor: '#0F4C81' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
    });
  }

  // Faculty: Trend Line Chart
  const ctxFac = document.getElementById('facultyTrendChart');
  if (ctxFac) {
    let attData = [95, 94, 92, 88, 85, 87];
    let engData = [88, 85, 80, 75, 76, 82];
    try {
      const d = await apiFetch('/api/faculty/dashboard');
      if (d.trendData) {
        attData = d.trendData.attendance;
        engData = d.trendData.engagement;
      }
    } catch (_) {}

    if (window.facultyChartInstance) window.facultyChartInstance.destroy();
    window.facultyChartInstance = new Chart(ctxFac, {
      type: 'line',
      data: {
        labels: ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6'],
        datasets: [
          {
            label: 'Avg Course Attendance %',
            data: attData,
            borderColor: '#0F4C81',
            backgroundColor: 'rgba(15, 76, 129, 0.1)',
            borderWidth: 2, fill: true, tension: 0.3
          },
          {
            label: 'Engagement Score',
            data: engData,
            borderColor: '#2FA4B1',
            borderDash: [5, 5],
            borderWidth: 2, tension: 0.3
          }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }

  // Admin: Semester Trend
  const ctxAdminTrend = document.getElementById('adminTrendChart');
  if (ctxAdminTrend) {
    let trendLabels = ['Fall 24', 'Spring 25', 'Fall 25', 'Spring 26', 'Fall 26'];
    let trendData = [78, 79, 76, 81, 82];
    try {
      const d = await apiFetch('/api/admin/dashboard');
      if (d.trendLabels) { trendLabels = d.trendLabels; trendData = d.trendData; }
    } catch (_) {}

    if (window.adminTrendInstance) window.adminTrendInstance.destroy();
    window.adminTrendInstance = new Chart(ctxAdminTrend, {
      type: 'line',
      data: {
        labels: trendLabels,
        datasets: [{ label: 'Historical Engagement Index', data: trendData, borderColor: '#0F4C81', tension: 0.2 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
    });
  }
}

// ─── Modals & Actions ─────────────────────────────────────────────────────────
let _currentStudentId = null;

async function openInterventionModal(studentId) {
  _currentStudentId = studentId || null;
  const el = document.getElementById('intervention-modal');
  if (el) el.style.display = 'block';

  // If on Admin page, populate the student dropdown
  const adminSelect = document.getElementById('admin-student-select');
  if (adminSelect) {
    try {
      adminSelect.innerHTML = '<option value="">Select Student...</option>';
      const data = await apiFetch('/api/faculty/students?courseId=1'); // Get all students from demo course
      const students = data.students || [];
      students.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.innerText = s.name;
        adminSelect.appendChild(opt);
      });
    } catch (_) {}
  }
}

function closeInterventionModal() {
  const el = document.getElementById('intervention-modal');
  if (el) el.style.display = 'none';
  _currentStudentId = null;
}

// Save Intervention — wire up if the button exists
document.addEventListener('DOMContentLoaded', () => {
  // Admin Action Hub Logic
  const actionBtns = document.querySelectorAll('.action-hub .btn');
  actionBtns.forEach(btn => {
    btn.onclick = async () => {
      const action = btn.innerText.trim();
      if (action === 'Log Intervention') {
        openInterventionModal();
      } else if (action === 'Export PDF Summary') {
        window.print();
      } else if (action === 'Send alerts') {
        try {
          const res = await apiFetch('/api/admin/broadcast-alerts', { method: 'POST' });
          alert(`📢 SUCCESS: ${res.message}\nRecipients: ${res.recipientsCount} high-risk students notified.`);
        } catch (err) {
          alert(`❌ Failed to send alerts: ${err.message}`);
        }
      } else if (action === 'Config Risk Thresholds') {
        const current = 60;
        const newVal = prompt(`Current High Risk Threshold: ${current}%\nEnter new threshold (percentage):`, current);
        if (newVal !== null) {
          const val = parseInt(newVal);
          if (isNaN(val) || val < 1 || val > 100) {
            alert('❌ Invalid Input: Please enter a percentage between 1 and 100.');
          } else {
            alert(`✅ Institutional policy updated. New risk threshold: ${val}%`);
          }
        }
      } else if (action === 'Manage Attendance Policy') {
        openPolicyModal();
      }
    };
  });

  // IT Admin Quick Actions Logic
  const syncBtn = document.getElementById('btn-manual-sync');
  if (syncBtn) {
    syncBtn.onclick = async () => {
      try {
        syncBtn.disabled = true;
        syncBtn.innerText = 'Syncing...';
        const res = await apiFetch('/api/itadmin/sync', { method: 'POST' });
        alert(`🔄 LMS Sync Complete!\nRecords Processed: ${res.recordsProcessed}\nStatus: ${res.message}`);
      } catch (err) {
        alert(`❌ Sync Failed: ${err.message}`);
      } finally {
        syncBtn.disabled = false;
        syncBtn.innerText = 'Trigger Manual Sync';
      }
    };
  }

  const reportBtn = document.getElementById('btn-gen-report');
  if (reportBtn) {
    reportBtn.onclick = () => {
      window.print();
    };
  }

  const policyBtn = document.getElementById('btn-manage-policy');
  if (policyBtn) {
    policyBtn.onclick = () => {
      openPolicyModal();
    };
  }
  const saveBtn = document.querySelector('#intervention-modal .btn-primary.block-btn');
  if (saveBtn) {
    saveBtn.onclick = async function () {
      const modal = document.getElementById('intervention-modal');
      const studentSelect = modal ? modal.querySelector('select') : null;
      const typeSelect = modal ? modal.querySelectorAll('select')[1] : null;
      const notes = modal ? modal.querySelector('textarea') : null;
      const followUp = modal ? modal.querySelector('input[type="date"]') : null;

      // Determine student ID — use from at-risk table click or fallback to first student
      let studentId = _currentStudentId;
      if (!studentId) {
        // Try to get from select name
        studentId = studentSelect ? studentSelect.value : null;
      }

      if (!studentId) {
        alert('Please select a student.');
        return;
      }

      try {
        await apiFetch('/api/interventions', {
          method: 'POST',
          body: {
            studentId: parseInt(studentId),
            interventionType: typeSelect ? typeSelect.value : 'Meeting',
            notes: notes ? notes.value : '',
            followUpDate: followUp ? followUp.value : null,
            status: 'Open'
          }
        });
        alert('✅ Intervention saved successfully!');
        closeInterventionModal();
        if (document.getElementById('advisor-student-list')) initAdvisorData();
      } catch (err) {
        alert(`❌ Failed to save: ${err.message}`);
      }
    };
  }
});

// ─── QR / OTP Session ─────────────────────────────────────────────────────────
let otpTimer = null;
let expiryTimer = null;
let _activeSessionId = null;

async function generateQR() {
  const el = document.getElementById('qr-modal');
  const courseSelect = document.getElementById('faculty-course-select');
  const qrImage = document.getElementById('qr-image');
  const qrLoading = document.getElementById('qr-loading');
  const modalCourse = document.getElementById('qr-modal-course');
  const otpExpiry = document.getElementById('otp-expiry');

  if (!el || !courseSelect) return;
  const courseId = courseSelect.value;
  if (courseId === 'all') {
    alert('Please select a specific course to start an attendance session.');
    return;
  }
  const courseName = courseSelect.options[courseSelect.selectedIndex].text;

  el.style.display = 'block';
  qrImage.style.display = 'none';
  qrLoading.style.display = 'block';
  modalCourse.innerText = `Scan to mark attendance for ${courseName}`;

  try {
    const data = await apiFetch('/api/sessions/create', {
      method: 'POST',
      body: { courseId }
    });

    _activeSessionId = data.sessionId;
    const otp = data.otp;

    console.log('Session created:', data);

    if (document.getElementById('modal-otp')) document.getElementById('modal-otp').innerText = otp;
    if (document.getElementById('session-otp')) document.getElementById('session-otp').innerText = otp;
    
    // Show QR Image
    if (qrImage) {
      if (data.qrImage) {
        qrImage.src = data.qrImage;
        qrImage.style.display = 'block';
        qrLoading.style.display = 'none';
        console.log('QR Image displayed successfully');
      } else {
        console.error('No qrImage in API response');
        qrLoading.innerText = 'Error: QR data missing';
      }
    } else {
      console.error('QR Image element not found');
    }

    const countEl = document.getElementById('live-count');
    if (countEl) countEl.innerText = '0';

    // 3-minute expiry timer
    let timeLeft = 180; // 3 minutes
    clearInterval(expiryTimer);
    expiryTimer = setInterval(() => {
      timeLeft--;
      if (timeLeft < 0) {
        clearInterval(expiryTimer);
        closeQRModal();
        alert('Session expired.');
        return;
      }
      const mins = String(Math.floor(timeLeft / 60)).padStart(2, '0');
      const secs = String(timeLeft % 60).padStart(2, '0');
      if (otpExpiry) otpExpiry.innerText = `Expires in ${mins}:${secs}`;
    }, 1000);

    // Poll live count and session attendance status every 3 seconds
    clearInterval(otpTimer);
    otpTimer = setInterval(async () => {
      if (el.style.display !== 'block') { clearInterval(otpTimer); return; }
      try {
        const [countData, presentData] = await Promise.all([
          apiFetch(`/api/sessions/${_activeSessionId}/count`),
          apiFetch(`/api/sessions/${_activeSessionId}/present-students`)
        ]);

        if (countEl) countEl.innerText = countData.count;

        // Update table row statuses
        const presentIds = new Set(presentData.studentIds || []);
        _facultyStudents.forEach(s => {
          const statusEl = document.getElementById(`session-status-${s.id}`);
          if (statusEl) {
            if (presentIds.has(s.id)) {
              statusEl.innerHTML = '<span class="badge-risk badge-low">Present</span>';
            } else {
              statusEl.innerHTML = '<span class="badge-risk badge-high">Absent</span>';
            }
          }
        });
      } catch (_) {}
    }, 3000);

  } catch (err) {
    alert(`❌ Failed to create session: ${err.message}`);
    el.style.display = 'none';
  }
}

async function closeQRModal() {
  const el = document.getElementById('qr-modal');
  if (el) el.style.display = 'none';
  clearInterval(otpTimer);
  clearInterval(expiryTimer);

  // Close the session on the backend
  if (_activeSessionId) {
    try {
      await apiFetch(`/api/sessions/${_activeSessionId}/close`, { method: 'POST' });
    } catch (_) {}
    _activeSessionId = null;
  }
  // Refresh data to show final attendance rates
  initFacultyData();
}

async function viewStudentProfile(studentId) {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;

  try {
    const data = await apiFetch(`/api/advisor/student/${studentId}`);
    const s = data.student;
    
    document.getElementById('profile-name').innerText = s.name;
    document.getElementById('profile-email').innerText = s.email;
    document.getElementById('profile-dept').innerText = s.department || 'N/A';
    document.getElementById('profile-status').innerText = s.status || 'Active';
    document.getElementById('profile-engagement').innerText = Math.round(data.engagementIndex) + ' / 100';
    document.getElementById('profile-attendance').innerText = data.avgAttendance + '%';
    
    modal.style.display = 'block';
  } catch (err) {
    alert('Failed to load profile: ' + err.message);
  }
}

function closeProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) modal.style.display = 'none';
}

// --- Attendance Policy Management ---
async function openPolicyModal() {
  const modal = document.getElementById('policy-modal');
  if (!modal) return;
  
  try {
    const data = await apiFetch('/api/admin/settings');
    const settings = data.settings.reduce((acc, curr) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    
    // Set default values if not present in DB
    document.getElementById('policy-min-sessions').value = settings.min_sessions || '3';
    document.getElementById('policy-strategy').value = settings.sync_strategy || 'Daily Roll-up';
    document.getElementById('policy-sync-interval').value = settings.sync_interval || '6';
    document.getElementById('policy-data-retention').value = settings.data_retention || '4';
    
    modal.style.display = 'block';
  } catch (err) {
    alert('Failed to load settings: ' + err.message);
  }
}

function closePolicyModal() {
  const modal = document.getElementById('policy-modal');
  if (modal) modal.style.display = 'none';
}

async function savePolicySettings() {
  const minSessions = document.getElementById('policy-min-sessions').value;
  const syncStrategy = document.getElementById('policy-strategy').value;
  const syncInterval = document.getElementById('policy-sync-interval').value;
  const dataRetention = document.getElementById('policy-data-retention').value;
  
  try {
    await apiFetch('/api/admin/settings/min_sessions', { method: 'PUT', body: JSON.stringify({ value: minSessions }) });
    await apiFetch('/api/admin/settings/sync_strategy', { method: 'PUT', body: JSON.stringify({ value: syncStrategy }) });
    await apiFetch('/api/admin/settings/sync_interval', { method: 'PUT', body: JSON.stringify({ value: syncInterval }) });
    await apiFetch('/api/admin/settings/data_retention', { method: 'PUT', body: JSON.stringify({ value: dataRetention }) });
    
    alert('✅ Policy settings updated successfully.');
    closePolicyModal();
  } catch (err) {
    alert('❌ Failed to save settings: ' + err.message);
  }
}