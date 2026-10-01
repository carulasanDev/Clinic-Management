(() => {
      "use strict";

      const STORAGE_KEY = "harbor-clinic-care-desk-v1";
      const STATUS = ["Waiting", "In Consultation", "Completed"];
      const PRIORITIES = ["Routine", "Priority", "Urgent"];
      const TEMPLATES = {
        hypertension: {
          name: "Hypertension Follow-Up",
          description: "Blood pressure review and lifestyle counseling",
          soap: {
            subjective: "Returns for blood pressure follow-up. Reports taking medications as prescribed. Denies headache, chest pain, shortness of breath, or dizziness.",
            objective: "Blood pressure reviewed. Patient alert and comfortable. Heart rate and cardiopulmonary examination documented.",
            assessment: "Essential hypertension, follow-up. Review blood pressure trend and medication tolerance.",
            plan: "Continue current treatment if clinically appropriate. Reinforce reduced-sodium diet, regular activity, and home blood pressure monitoring. Arrange follow-up as indicated."
          },
          medications: [{ name: "", dose: "", frequency: "", duration: "" }]
        },
        uri: {
          name: "Acute URI",
          description: "Upper respiratory symptom assessment and supportive care",
          soap: {
            subjective: "Reports recent onset of upper respiratory symptoms. Review duration, fever, cough, congestion, exposures, and relevant red flags.",
            objective: "Document temperature, oxygen saturation, hydration, and focused respiratory and ENT examination.",
            assessment: "Acute upper respiratory symptoms. Evaluate for complications and likely etiology based on clinical findings.",
            plan: "Discuss supportive care, hydration, and return precautions. Use testing or medication only when clinically indicated. Reassess if symptoms worsen or persist."
          },
          medications: [{ name: "", dose: "", frequency: "", duration: "" }]
        },
        diabetes: {
          name: "Diabetes Management",
          description: "Glucose control, medication review, and preventive care",
          soap: {
            subjective: "Returns for diabetes review. Discuss home glucose readings, medication adherence, diet, activity, hypoglycemia, and new symptoms.",
            objective: "Review available glucose and laboratory results. Document weight, blood pressure, and focused examination.",
            assessment: "Diabetes mellitus, follow-up. Glycemic control and complication risk reviewed with available data.",
            plan: "Review individualized glucose goals and treatment options. Reinforce nutrition, activity, foot care, and recommended monitoring. Arrange appropriate labs and follow-up."
          },
          medications: [{ name: "", dose: "", frequency: "", duration: "" }]
        }
      };

      const $ = (selector, root = document) => root.querySelector(selector);
      const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      })[character]);
      const id = () => globalThis.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const initials = (name) => String(name || "Doctor").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
      const now = () => new Date().toISOString();
      const formatTime = (value) => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(value));
      const formatDateTime = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
      const localDateKey = (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      };
      const dateKeyOffset = (offset) => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + offset);
        return localDateKey(date);
      };

      const makeDemoPatient = (data) => ({
        id: id(), createdAt: now(), status: "Waiting", triage: "Routine", dob: "", sex: "", phone: "",
        complaint: "", vitals: { bloodPressure: "", pulse: "", temperature: "", height: "", weight: "" },
        soap: { subjective: "", objective: "", assessment: "", plan: "" },
        medications: [], ...data
      });
      const seedPatients = () => [
        makeDemoPatient({ name: "Maya Bennett", age: "42", sex: "Female", phone: "(555) 014-0281", complaint: "Blood pressure follow-up", triage: "Priority", status: "Waiting", demo: true, vitals: { bloodPressure: "138/86", pulse: "74", temperature: "36.8", height: "165", weight: "68" } }),
        makeDemoPatient({ name: "Ethan Brooks", age: "29", sex: "Male", phone: "(555) 014-0392", complaint: "Cough and congestion", triage: "Routine", status: "In Consultation", demo: true, vitals: { bloodPressure: "122/78", pulse: "82", temperature: "37.2", height: "178", weight: "76" } }),
        makeDemoPatient({ name: "Olivia Chen", age: "56", sex: "Female", phone: "(555) 014-0415", complaint: "Diabetes review", triage: "Urgent", status: "Waiting", demo: true, vitals: { bloodPressure: "146/91", pulse: "88", temperature: "36.7", height: "160", weight: "71" } })
      ];
      const blankState = () => ({
        version: 1, patients: seedPatients(), intakeDraft: {}, profile: {
          fullName: "", license: "", specialty: "", clinicName: "Harbor Clinic", contact: "", bio: "", photo: "", signature: "", syncEndpoint: ""
        }, pendingActions: [], logs: [], activePatientId: "", selectedRxPatientId: "", syncOverride: null
      });
      const loadState = () => {
        try {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (!raw) return blankState();
          const parsed = JSON.parse(raw);
          if (parsed?.version !== 1 || !Array.isArray(parsed.patients) || !parsed.profile) throw new Error("The saved clinic data has an unsupported format.");
          const defaults = blankState();
          return { ...defaults, ...parsed, patients: parsed.patients, intakeDraft: parsed.intakeDraft || {}, profile: { ...defaults.profile, ...parsed.profile } };
        } catch (error) {
          if (error instanceof SyntaxError || error instanceof TypeError) {
            throw new Error("Saved clinic data could not be read. Your browser storage was not changed.", { cause: error });
          }
          throw error;
        }
      };

      let state;
      try {
        state = loadState();
      } catch (error) {
        document.body.innerHTML = `<main style="max-width:620px;margin:12vh auto;padding:28px;font:14px/1.6 system-ui;color:#192c3b"><h1>Clinic data could not be opened</h1><p>${escapeHtml(error.message)}</p><p>To protect patient records, this app did not overwrite the saved data. Resolve the browser storage issue and reload.</p></main>`;
        return;
      }

      let activeTab = "queue";
      let queueFilter = "All";
      let searchQuery = "";
      let analyticsRange = 7;
      let syncTimer;
      let medicationSaveTimer;
      let syncInFlight = false;
      let syncRetryBlocked = false;
      let rxDraftSignature = "";
      let profileEditing = false;
      let profileDraft = null;
      let soapDraft = null;
      let canvasContext;
      let drawing = false;
      let suppressMouseUntil = 0;
      let activePoint = null;
      let actualOnline = navigator.onLine;

      const isOnline = () => state.syncOverride === null ? actualOnline : state.syncOverride;
      const toast = (message, isError = false) => {
        const element = document.createElement("div");
        element.className = `toast${isError ? " error" : ""}`;
        element.textContent = message;
        $("#toast-region").append(element);
        setTimeout(() => element.remove(), 3700);
      };
      const saveLocal = () => {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
          return true;
        } catch (error) {
          const detail = error?.name === "QuotaExceededError" ? "Browser storage is full. Export or remove stored data before continuing." : `Could not save clinic data: ${error.message}`;
          toast(detail, true);
          return false;
        }
      };
      const addLog = (action, message, result = "info") => {
        state.logs.unshift({ id: id(), time: now(), action, message, result });
        state.logs = state.logs.slice(0, 150);
      };
      const commitMutation = (action, entityId, details, immediate = false) => {
        clearTimeout(syncTimer);
        const timestamp = now();
        state.pendingActions.push({ id: id(), entityId, action, timestamp, details, resolution: "local-wins" });
        addLog(action, `${action} saved on this device.`, "pending");
        renderHeader();
        const saved = saveLocal();
        if (!saved) return;
        if (activeTab === "patient-records") renderPatientRecords();
        if (immediate) trySync();
        else {
          clearTimeout(syncTimer);
          syncTimer = setTimeout(trySync, 900);
        }
      };
      const patientById = (patientId) => state.patients.find((patient) => patient.id === patientId);
      const selectedPatient = () => patientById(state.activePatientId) || state.patients[0] || null;
      const setActivePatient = (patientId) => {
        state.activePatientId = patientId;
        saveLocal();
      };
      const badge = (value) => `<span class="badge ${escapeHtml(String(value).toLowerCase().replaceAll(" ", "-"))}">${escapeHtml(value)}</span>`;
      const pageHeading = (eyebrow, title, description, actions = "") => `
        <div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="heading-copy">${description}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ""}</div>`;

      function renderHeader() {
        const profile = state.profile;
        $("#today-label").textContent = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date());
        $("#network-label").textContent = isOnline() ? "Online" : "Offline · saved locally";
        $("#network-pill").classList.toggle("offline", !isOnline());
        $("#nav-queue-count").textContent = String(state.patients.filter((patient) => patient.status !== "Completed").length);
        $("#nav-sync-count").textContent = String(state.pendingActions.length);
        $("#nav-record-count").textContent = String(state.patients.length);
        $("#profile-initials").textContent = initials(profile.fullName);
        $("#profile-initials").hidden = Boolean(profile.photo);
        $("#profile-mini").hidden = !profile.photo;
        if (profile.photo) $("#profile-mini").src = profile.photo;
      }

      function renderQueue() {
        const rows = state.patients
          .filter((patient) => queueFilter === "All" || patient.status === queueFilter)
          .filter((patient) => `${patient.name} ${patient.complaint} ${patient.phone}`.toLowerCase().includes(searchQuery.toLowerCase()))
          .slice()
          .sort((a, b) => ({ Urgent: 0, Priority: 1, Routine: 2 }[a.triage] - { Urgent: 0, Priority: 1, Routine: 2 }[b.triage]) || new Date(a.createdAt) - new Date(b.createdAt));
        const waiting = state.patients.filter((patient) => patient.status === "Waiting").length;
        const consulting = state.patients.filter((patient) => patient.status === "In Consultation").length;
        const completed = state.patients.filter((patient) => patient.status === "Completed").length;
        const greeting = `Good ${new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}${state.profile.fullName ? `, Dr. ${escapeHtml(state.profile.fullName.split(" ").at(-1))}` : ""}`;
        $("#tab-queue").innerHTML = `
          ${pageHeading("Clinic overview", greeting, "Here’s what’s happening at your clinic today. Fictional sample records are marked in the queue.", `<button class="button primary" data-action="go-checkin">＋ Check in patient</button>`)}
          <div class="stats-grid">
            <div class="stat-card"><div class="stat-label">Waiting</div><div class="stat-value">${waiting}</div><div class="stat-note">Ready to be seen</div></div>
            <div class="stat-card"><div class="stat-label">In consultation</div><div class="stat-value">${consulting}</div><div class="stat-note">With the care team</div></div>
            <div class="stat-card"><div class="stat-label">Completed today</div><div class="stat-value">${completed}</div><div class="stat-note">Visits marked complete</div></div>
            <div class="stat-card"><div class="stat-label">Pending sync</div><div class="stat-value">${state.pendingActions.length}</div><div class="stat-note">${isOnline() ? "Saved locally · endpoint optional" : "Will retry when online"}</div></div>
          </div>
          <div class="panel">
            <div class="panel-head"><div><h2 class="panel-title">Patient queue</h2><p class="panel-description">Triage, visit status, and check-in details</p></div>${badge(`${state.patients.length} total`)}</div>
            <div class="queue-toolbar">
              <label class="search-wrap"><span class="search-symbol">⌕</span><input id="queue-search" type="search" placeholder="Search patients..." value="${escapeHtml(searchQuery)}" aria-label="Search patients"></label>
              <div class="filter-row" role="group" aria-label="Filter queue">${["All", ...STATUS].map((filter) => `<button class="filter-button ${queueFilter === filter ? "active" : ""}" data-filter="${escapeHtml(filter)}">${escapeHtml(filter)}</button>`).join("")}</div>
            </div>
            ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Patient</th><th>Chief complaint</th><th>Triage</th><th>Checked in</th><th>Visit status</th><th>Actions</th></tr></thead><tbody>${rows.map((patient) => `
              <tr>
                <td><div class="patient-cell"><span class="avatar">${escapeHtml(initials(patient.name))}</span><div><div class="patient-name">${escapeHtml(patient.name)}</div><div class="patient-meta">${escapeHtml(patient.age || "Age not recorded")}${patient.sex ? ` · ${escapeHtml(patient.sex)}` : ""}${patient.demo ? " · sample record" : ""}</div></div></div></td>
                <td>${escapeHtml(patient.complaint || "Not specified")}</td>
                <td>${badge(patient.triage)}</td>
                <td>${formatTime(patient.createdAt)}</td>
                <td><div class="status-control ${escapeHtml(patient.status.toLowerCase().replaceAll(" ", "-"))}"><span class="status-indicator" aria-hidden="true"></span><select class="status-select" data-status-id="${escapeHtml(patient.id)}" aria-label="Visit status for ${escapeHtml(patient.name)}">${STATUS.map((status) => `<option ${patient.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></div></td>
                <td><div class="table-actions"><button class="button small soft" data-action="open-soap" data-patient-id="${escapeHtml(patient.id)}">Open chart</button></div></td>
              </tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><div class="empty-icon">◎</div><strong>${state.patients.length ? "No matching patients" : "Your queue is clear"}</strong><span>${state.patients.length ? "Try a different filter or search." : "Check in a patient to get started."}</span></div>`}
          </div>`;
      }

      function renderCheckin() {
        const draft = state.intakeDraft || {};
        $("#tab-checkin").innerHTML = `
          ${pageHeading("Patient intake", "Check in a patient", "Capture the essentials and add them to the live queue.")}
          <div class="checkin-layout">
            <form class="panel" id="checkin-form">
              <div class="panel-head"><div><h2 class="panel-title">Patient details</h2><p class="panel-description">New check-ins are stored on this device immediately.</p></div></div>
              <div class="panel-body">
                <div class="form-grid">
                  <div class="field"><label for="intake-name">Full name *</label><input id="intake-name" name="name" required autocomplete="name" placeholder="Patient name" value="${escapeHtml(draft.name)}"></div>
                  <div class="field"><label for="intake-phone">Phone</label><input id="intake-phone" name="phone" type="tel" autocomplete="tel" placeholder="(555) 000-0000" value="${escapeHtml(draft.phone)}"></div>
                  <div class="field"><label for="intake-age">Age</label><input id="intake-age" name="age" type="number" min="0" max="125" inputmode="numeric" placeholder="Years" value="${escapeHtml(draft.age)}"></div>
                  <div class="field"><label for="intake-sex">Sex</label><select id="intake-sex" name="sex"><option value="">Select...</option><option ${draft.sex === "Female" ? "selected" : ""}>Female</option><option ${draft.sex === "Male" ? "selected" : ""}>Male</option><option ${draft.sex === "Intersex" ? "selected" : ""}>Intersex</option><option ${draft.sex === "Prefer not to say" ? "selected" : ""}>Prefer not to say</option></select></div>
                  <div class="field full"><label for="intake-complaint">Chief complaint</label><input id="intake-complaint" name="complaint" placeholder="What brings the patient in today?" value="${escapeHtml(draft.complaint)}"></div>
                  <div class="field full"><label>Triage priority</label><div class="triage-options">${PRIORITIES.map((priority, index) => `<label class="triage-option"><input type="radio" name="triage" value="${priority}" ${draft.triage ? draft.triage === priority ? "checked" : "" : index === 0 ? "checked" : ""}><span>${priority}</span></label>`).join("")}</div></div>
                </div>
                <h3 style="font-size:12px;margin:22px 0 12px">Vitals <span class="field-hint">(optional)</span></h3>
                <div class="form-grid three">
                  <div class="field"><label for="intake-bp">Blood pressure</label><input id="intake-bp" name="bloodPressure" inputmode="decimal" placeholder="120/80" value="${escapeHtml(draft.bloodPressure)}"></div>
                  <div class="field"><label for="intake-pulse">Pulse · bpm</label><input id="intake-pulse" name="pulse" type="number" min="0" placeholder="72" value="${escapeHtml(draft.pulse)}"></div>
                  <div class="field"><label for="intake-temp">Temperature · °C</label><input id="intake-temp" name="temperature" type="number" step="0.1" placeholder="36.8" value="${escapeHtml(draft.temperature)}"></div>
                  <div class="field"><label for="intake-height">Height · cm</label><input id="intake-height" name="height" type="number" min="0" step="0.1" placeholder="170" value="${escapeHtml(draft.height)}"></div>
                  <div class="field"><label for="intake-weight">Weight · kg</label><input id="intake-weight" name="weight" type="number" step="0.1" placeholder="70" value="${escapeHtml(draft.weight)}"></div>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px"><button type="reset" class="button">Clear form</button><button class="button primary" type="submit">Add to queue</button></div>
              </div>
            </form>
            <aside class="panel"><div class="panel-head"><div><h2 class="panel-title">Intake notes</h2><p class="panel-description">A faster start to the visit</p></div></div><div class="panel-body"><div class="info-callout">Patients are saved to this browser as soon as you add them. No network connection is required. Only collect information necessary for care, and use a device secured for clinical use.</div><div class="summary-vitals"><div class="vital-tile"><span>Waiting now</span><strong>${state.patients.filter((patient) => patient.status === "Waiting").length} patients</strong></div><div class="vital-tile"><span>Urgent triage</span><strong>${state.patients.filter((patient) => patient.triage === "Urgent" && patient.status !== "Completed").length} active</strong></div></div></div></aside>
          </div>`;
      }

      function getAnalyticsDays(range = analyticsRange) {
        return Array.from({ length: range }, (_, index) => {
          const key = dateKeyOffset(index - range + 1);
          const date = new Date(`${key}T00:00:00`);
          return {
            key,
            date,
            patients: state.patients.filter((patient) => localDateKey(patient.createdAt) === key)
          };
        });
      }

      function renderPatientRecords() {
        const days = getAnalyticsDays();
        const maxPatients = Math.max(1, ...days.map((day) => day.patients.length));
        const selectedTotal = days.reduce((total, day) => total + day.patients.length, 0);
        const todayPatients = state.patients.filter((patient) => localDateKey(patient.createdAt) === dateKeyOffset(0));
        const urgentPatients = state.patients.filter((patient) => patient.triage === "Urgent" && patient.status !== "Completed").length;
        const completedPatients = state.patients.filter((patient) => patient.status === "Completed").length;
        const completionRate = state.patients.length ? Math.round(completedPatients / state.patients.length * 100) : 0;
        const latestPatients = state.patients.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const todayKey = dateKeyOffset(0);
        $("#tab-patient-records").innerHTML = `
          ${pageHeading("Workspace analytics", "Patient records", "Live check-in trends and visit snapshots from records saved on this device.", `<button class="button primary" data-action="export-patient-workbook">⇩ Export Excel workbook</button>`)}
          <div class="analytics-summary">
            <div class="stat-card"><div class="stat-label">Patients today</div><div class="stat-value">${todayPatients.length}</div><div class="stat-note">Check-ins recorded today</div></div>
            <div class="stat-card"><div class="stat-label">Last ${analyticsRange} days</div><div class="stat-value">${selectedTotal}</div><div class="stat-note">Patient check-ins in range</div></div>
            <div class="stat-card"><div class="stat-label">Urgent in queue</div><div class="stat-value">${urgentPatients}</div><div class="stat-note">Urgent, not completed</div></div>
            <div class="stat-card"><div class="stat-label">Completed visits</div><div class="stat-value">${completionRate}%</div><div class="stat-note">${completedPatients} of ${state.patients.length} patient records</div></div>
          </div>
          <div class="analytics-layout">
            <section class="panel">
              <div class="panel-head"><div><h2 class="panel-title">Daily patient check-ins</h2><p class="panel-description">Progress bars show recorded visits per calendar day.</p></div><div class="filter-row" role="group" aria-label="Analytics date range">${[7, 14, 30].map((range) => `<button class="filter-button ${analyticsRange === range ? "active" : ""}" data-chart-range="${range}">${range} days</button>`).join("")}</div></div>
              <div class="panel-body">
                <div class="chart-list" role="img" aria-label="Daily patient check-ins over the last ${analyticsRange} days">${days.map((day) => {
                  const count = day.patients.length;
                  const width = count ? Math.max(6, count / maxPatients * 100) : 0;
                  const label = day.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
                  return `<div class="chart-row"><span class="chart-date ${day.key === todayKey ? "today" : ""}">${escapeHtml(label)}${day.key === todayKey ? " · Today" : ""}</span><div class="chart-track" aria-label="${count} patients"><div class="chart-bar" style="width:${width}%"></div></div><span class="chart-count">${count}</span></div>`;
                }).join("")}</div>
                <div class="chart-legend"><span class="status-indicator" style="background:var(--blue)"></span>Patient check-ins saved on this device</div>
                <p class="analytics-footnote">Counts use each patient's check-in date and update as new records are added. This report reflects local browser records only; zero-count days are real zeros, not simulated patient data.</p>
              </div>
            </section>
            <section class="panel">
              <div class="panel-head"><div><h2 class="panel-title">Latest patient snapshots</h2><p class="panel-description">${latestPatients.length} patient records available for export</p></div></div>
              ${latestPatients.length ? `<div class="panel-body"><div class="record-list">${latestPatients.slice(0, 8).map((patient) => {
                const vitals = [
                  ["BP", patient.vitals?.bloodPressure],
                  ["Pulse", patient.vitals?.pulse && `${patient.vitals.pulse} bpm`],
                  ["Temp", patient.vitals?.temperature && `${patient.vitals.temperature} °C`],
                  ["Height", patient.vitals?.height && `${patient.vitals.height} cm`],
                  ["Weight", patient.vitals?.weight && `${patient.vitals.weight} kg`]
                ].filter(([, value]) => value);
                const soapSaved = Object.values(patient.soap || {}).some((value) => String(value || "").trim());
                const medications = (patient.medications || []).filter((medication) => medication.name?.trim()).length;
                return `<article class="record-card">
                  <div class="record-card-top"><div class="patient-cell"><span class="avatar">${escapeHtml(initials(patient.name))}</span><div><div class="patient-name">${escapeHtml(patient.name)}</div><div class="patient-meta">${escapeHtml(patient.age || "Age not recorded")}${patient.sex ? ` · ${escapeHtml(patient.sex)}` : ""}${patient.demo ? " · sample record" : ""}</div></div></div>${badge(patient.status)}</div>
                  <div class="patient-meta">${escapeHtml(patient.complaint || "No chief complaint")} · ${escapeHtml(formatDateTime(patient.createdAt))}</div>
                  ${vitals.length ? `<div class="record-snapshot">${vitals.map(([label, value]) => `<div class="vital-tile"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>` : ""}
                  <div class="record-card-actions"><button class="button small" data-action="record-open-soap" data-patient-id="${escapeHtml(patient.id)}">${soapSaved ? "View SOAP note" : "Add SOAP note"}</button><button class="button small" data-action="record-open-rx" data-patient-id="${escapeHtml(patient.id)}">Prescriptions · ${medications}</button></div>
                </article>`;
              }).join("")}</div></div>` : `<div class="empty-state"><strong>No patient records yet</strong><span>Check in a patient to start seeing analytics here.</span></div>`}
            </section>
          </div>`;
      }

      const excelColumnName = (number) => {
        let name = "";
        for (let value = number; value > 0; value = Math.floor((value - 1) / 26)) {
          name = String.fromCharCode(65 + (value - 1) % 26) + name;
        }
        return name;
      };

      const excelXmlEscape = (value) => String(value ?? "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");

      function makeWorksheetXml(rows, tableId) {
        const columnCount = Math.max(1, ...rows.map((row) => row.length));
        const rowXml = rows.map((row, rowIndex) => {
          const cells = row.map((value, columnIndex) => {
            const ref = `${excelColumnName(columnIndex + 1)}${rowIndex + 1}`;
            if (typeof value === "number" && Number.isFinite(value)) {
              return `<c r="${ref}"${rowIndex < 2 ? ` s="${rowIndex === 0 ? 1 : 2}"` : ""}><v>${value}</v></c>`;
            }
              return `<c r="${ref}" t="inlineStr"${rowIndex < 2 ? ` s="${rowIndex === 0 ? 1 : 2}"` : ""}><is><t xml:space="preserve">${excelXmlEscape(value)}</t></is></c>`;
          }).join("");
          return `<row r="${rowIndex + 1}">${cells}</row>`;
        }).join("");
        const lastColumn = excelColumnName(columnCount);
        const lastRow = Math.max(1, rows.length);
        const widths = Array.from({ length: columnCount }, (_, columnIndex) => {
          const maxLength = Math.max(10, ...rows.map((row) => String(row[columnIndex] ?? "").length));
          return `<col min="${columnIndex + 1}" max="${columnIndex + 1}" width="${Math.min(42, Math.max(12, maxLength + 2))}" customWidth="1"/>`;
        }).join("");
        const hasTable = Boolean(tableId) && rows.length > 2;
        const tableParts = hasTable ? `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>` : "";
        const relationshipNamespace = hasTable ? ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` : "";
        const titleMerge = columnCount > 1 ? `<mergeCells count="1"><mergeCell ref="A1:${lastColumn}1"/></mergeCells>` : "";
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"${relationshipNamespace}><dimension ref="A1:${lastColumn}${lastRow}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${widths}</cols><sheetData>${rowXml}</sheetData>${titleMerge}<pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>${tableParts}</worksheet>`;
      }

      function makeTableXml(sheet, tableId) {
        const headers = sheet.rows[1];
        const lastColumn = excelColumnName(headers.length);
        const range = `A2:${lastColumn}${sheet.rows.length}`;
        const columns = headers.map((header, index) =>
          `<tableColumn id="${index + 1}" name="${excelXmlEscape(header)}"/>`
        ).join("");
        return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${tableId}" name="${sheet.tableName}" displayName="${sheet.tableName}" ref="${range}" totalsRowShown="0"><autoFilter ref="${range}"/><tableColumns count="${headers.length}">${columns}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
      }

      function createStoredZip(files) {
        const encoder = new TextEncoder();
        const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
          let value = index;
          for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
          return value >>> 0;
        });
        const crc32 = (bytes) => {
          let crc = 0xFFFFFFFF;
          for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
          return (crc ^ 0xFFFFFFFF) >>> 0;
        };
        const makeHeader = (length, write) => {
          const bytes = new Uint8Array(length);
          write(new DataView(bytes.buffer));
          return bytes;
        };
        const localEntries = [];
        const centralEntries = [];
        let offset = 0;
        const timestamp = new Date();
        const dosTime = (timestamp.getHours() << 11) | (timestamp.getMinutes() << 5) | Math.floor(timestamp.getSeconds() / 2);
        const dosDate = ((Math.max(1980, timestamp.getFullYear()) - 1980) << 9) | ((timestamp.getMonth() + 1) << 5) | timestamp.getDate();

        for (const [filename, contents] of files) {
          const filenameBytes = encoder.encode(filename);
          const dataBytes = encoder.encode(contents);
          const checksum = crc32(dataBytes);
          const localHeader = makeHeader(30 + filenameBytes.length, (view) => {
            view.setUint32(0, 0x04034B50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 0x0800, true);
            view.setUint16(8, 0, true);
            view.setUint16(10, dosTime, true);
            view.setUint16(12, dosDate, true);
            view.setUint32(14, checksum, true);
            view.setUint32(18, dataBytes.length, true);
            view.setUint32(22, dataBytes.length, true);
            view.setUint16(26, filenameBytes.length, true);
            view.setUint16(28, 0, true);
            new Uint8Array(view.buffer).set(filenameBytes, 30);
          });
          localEntries.push(localHeader, dataBytes);

          const centralHeader = makeHeader(46 + filenameBytes.length, (view) => {
            view.setUint32(0, 0x02014B50, true);
            view.setUint16(4, 20, true);
            view.setUint16(6, 20, true);
            view.setUint16(8, 0x0800, true);
            view.setUint16(10, 0, true);
            view.setUint16(12, dosTime, true);
            view.setUint16(14, dosDate, true);
            view.setUint32(16, checksum, true);
            view.setUint32(20, dataBytes.length, true);
            view.setUint32(24, dataBytes.length, true);
            view.setUint16(28, filenameBytes.length, true);
            view.setUint16(30, 0, true);
            view.setUint16(32, 0, true);
            view.setUint16(34, 0, true);
            view.setUint16(36, 0, true);
            view.setUint32(38, 0, true);
            view.setUint32(42, offset, true);
            new Uint8Array(view.buffer).set(filenameBytes, 46);
          });
          centralEntries.push(centralHeader);
          offset += localHeader.length + dataBytes.length;
        }

        const centralSize = centralEntries.reduce((total, entry) => total + entry.length, 0);
        const endRecord = makeHeader(22, (view) => {
          view.setUint32(0, 0x06054B50, true);
          view.setUint16(4, 0, true);
          view.setUint16(6, 0, true);
          view.setUint16(8, files.length, true);
          view.setUint16(10, files.length, true);
          view.setUint32(12, centralSize, true);
          view.setUint32(16, offset, true);
          view.setUint16(20, 0, true);
        });
        return new Blob([...localEntries, ...centralEntries, endRecord], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
      }

      function exportPatientWorkbook() {
        const patients = state.patients.slice().sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const patientHeaders = ["Patient ID", "Patient name", "Age", "Sex", "Phone", "Check-in date/time", "Chief complaint", "Triage priority", "Visit status", "Blood pressure", "Pulse (bpm)", "Temperature (°C)", "Height (cm)", "Weight (kg)", "Sample record"];
        const patientRows = patients.map((patient) => [
          patient.id, patient.name, patient.age || "", patient.sex || "", patient.phone || "", patient.createdAt || "",
          patient.complaint || "", patient.triage || "", patient.status || "", patient.vitals?.bloodPressure || "",
          patient.vitals?.pulse || "", patient.vitals?.temperature || "", patient.vitals?.height || "", patient.vitals?.weight || "",
          patient.demo ? "Yes" : "No"
        ]);
        const soapRows = patients.map((patient) => [
          patient.id, patient.name, patient.createdAt || "", patient.soap?.subjective || "", patient.soap?.objective || "",
          patient.soap?.assessment || "", patient.soap?.plan || ""
        ]);
        const medicationHeaders = ["Patient ID", "Patient name", "Prescription details"];
        const medicationRows = patients.map((patient) => {
          const medications = (patient.medications || []).filter((medication) => medication.name?.trim());
          const prescriptionDetails = medications.length
            ? medications.map((medication) => [
              medication.name.trim(),
              medication.dose?.trim() && `Dose: ${medication.dose.trim()}`,
              medication.frequency?.trim() && `Frequency: ${medication.frequency.trim()}`,
              medication.duration?.trim() && `Duration: ${medication.duration.trim()}`
            ].filter(Boolean).join("; ")).join(" | ")
            : "No prescription recorded";
          return [patient.id, patient.name, prescriptionDetails];
        });
        const analyticsRows = [["Date", "Daily check-ins", "Waiting now", "In consultation now", "Completed now", "Urgent check-ins"]];
        for (const day of getAnalyticsDays(30)) {
          analyticsRows.push([
            day.key,
            day.patients.length,
            day.patients.filter((patient) => patient.status === "Waiting").length,
            day.patients.filter((patient) => patient.status === "In Consultation").length,
            day.patients.filter((patient) => patient.status === "Completed").length,
            day.patients.filter((patient) => patient.triage === "Urgent").length
          ]);
        }

        const sheets = [
          { name: "Patient Snapshot", tableName: "PatientSnapshotTable", rows: [["Patient Snapshot"], patientHeaders, ...patientRows] },
          { name: "SOAP Notes", tableName: "SoapNotesTable", rows: [["SOAP Notes"], ["Patient ID", "Patient name", "Check-in date/time", "Subjective", "Objective", "Assessment", "Plan"], ...soapRows] },
          { name: "Prescriptions", tableName: "PrescriptionsTable", rows: [["Prescriptions"], medicationHeaders, ...medicationRows] },
          { name: "Daily Analytics", tableName: "DailyAnalyticsTable", rows: [["Daily Analytics"], ...analyticsRows] }
        ];
        const workbookFiles = [
          ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}${sheets.map((sheet, index) => sheet.rows.length > 2 ? `<Override PartName="/xl/tables/table${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>` : "").join("")}</Types>`],
          ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
          ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${excelXmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets><calcPr calcId="191029"/></workbook>`],
          ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
          ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="14"/><name val="Calibri"/></font><font><b/><color rgb="FF183447"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF183447"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8F4F7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
          ...sheets.map((sheet, index) => [`xl/worksheets/sheet${index + 1}.xml`, makeWorksheetXml(sheet.rows, index + 1)]),
          ...sheets.flatMap((sheet, index) => sheet.rows.length > 2 ? [
            [`xl/worksheets/_rels/sheet${index + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${index + 1}.xml"/></Relationships>`],
            [`xl/tables/table${index + 1}.xml`, makeTableXml(sheet, index + 1)]
          ] : [])
        ];
        try {
          const blob = createStoredZip(workbookFiles);
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `clinic-patient-records-${dateKeyOffset(0)}.xlsx`;
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          toast(`Excel workbook exported with ${patients.length} patient records and 4 worksheets.`);
        } catch (error) {
          toast(`Could not export the Excel workbook: ${error.message}`, true);
        }
      }

      function renderSoap() {
        const patient = selectedPatient();
        const editing = Boolean(patient && soapDraft?.patientId === patient.id);
        const displayedSoap = editing ? soapDraft.soap : patient?.soap || {};
        const patientMedications = patient?.medications || [];
        const displayedMedications = editing ? soapDraft.medications : patientMedications;
        const soapHasChanges = editing && (
          JSON.stringify(displayedSoap) !== JSON.stringify(patient.soap || {}) ||
          JSON.stringify(displayedMedications) !== JSON.stringify(patientMedications)
        );
        const patientOptions = state.patients.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === patient?.id ? "selected" : ""}>${escapeHtml(item.name)}${item.status === "Completed" ? " · completed" : ""}</option>`).join("");
        $("#tab-soap").innerHTML = `
          ${pageHeading("Clinical documentation", "SOAP workspace", "Review and save structured notes for the selected patient.")}
          <div class="workspace-layout">
            <div>
              <div class="panel" style="margin-bottom:15px">
                <div class="panel-head"><div><h2 class="panel-title">Visit note</h2><p class="panel-description">${editing ? "Changes are a draft until you save." : "Open Edit note to make changes to this patient's note."}</p></div>${editing ? `<div style="display:flex;gap:8px"><button class="button small" data-action="cancel-soap">Cancel</button><button class="button primary small" data-action="save-soap" ${soapHasChanges ? "" : "disabled"}>Save</button></div>` : patient ? `<button class="button primary small" data-action="edit-soap">Edit note</button>` : ""}</div>
                ${patient ? `<div class="panel-body">
                  <div class="field" style="max-width:440px;margin-bottom:17px"><label for="soap-patient">Patient</label><select id="soap-patient" ${editing ? "disabled" : ""}>${patientOptions}</select></div>
                  <div class="soap-grid">${[
                    ["subjective", "S", "Subjective", "Symptoms, history, and patient concerns..."],
                    ["objective", "O", "Objective", "Exam findings, measurements, and results..."],
                    ["assessment", "A", "Assessment", "Clinical impression and diagnoses..."],
                    ["plan", "P", "Plan", "Treatment, counseling, and follow-up..."]
                  ].map(([key, letter, label, placeholder]) => `<div class="soap-card"><label class="soap-label" for="soap-${key}"><span class="soap-letter">${letter}</span>${label}</label><textarea id="soap-${key}" data-soap-field="${key}" placeholder="${placeholder}" ${editing ? "" : "disabled"}>${escapeHtml(displayedSoap[key] || "")}</textarea></div>`).join("")}</div>
                </div>` : `<div class="empty-state"><strong>No patients to chart</strong><span>Check in a patient to begin a note.</span><div style="margin-top:12px"><button class="button primary" data-action="go-checkin">Check in patient</button></div></div>`}
              </div>
            </div>
            <aside>
              ${patient ? `<div class="panel" style="margin-bottom:15px"><div class="panel-head"><div><h2 class="panel-title">Patient snapshot</h2><p class="panel-description">Visit context at a glance</p></div></div><div class="panel-body">
                <div class="patient-summary"><span class="avatar">${escapeHtml(initials(patient.name))}</span><div><strong>${escapeHtml(patient.name)}</strong><div class="patient-meta">${escapeHtml(patient.age || "Age not recorded")}${patient.sex ? ` · ${escapeHtml(patient.sex)}` : ""}</div></div></div>
                <div class="cell-muted">CHIEF COMPLAINT</div><div style="font-weight:650;margin:5px 0 12px">${escapeHtml(patient.complaint || "Not specified")}</div>${badge(patient.triage)}
                <div class="summary-vitals">${[["BP", patient.vitals?.bloodPressure], ["Pulse", patient.vitals?.pulse && `${patient.vitals.pulse} bpm`], ["Temp", patient.vitals?.temperature && `${patient.vitals.temperature} °C`], ["Height", patient.vitals?.height && `${patient.vitals.height} cm`], ["Weight", patient.vitals?.weight && `${patient.vitals.weight} kg`]].filter(([, value]) => value).map(([label, value]) => `<div class="vital-tile"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("") || `<div class="field-hint">No vitals recorded for this visit.</div>`}</div>
              </div></div>` : ""}
              <div class="panel"><div class="panel-head"><div><h2 class="panel-title">Quick order sets</h2><p class="panel-description">${editing ? "Insert prompts into this draft; Save to keep them." : "Edit the note to use a quick order set."}</p></div></div><div class="panel-body"><div class="quick-orders">${Object.entries(TEMPLATES).map(([key, template]) => `<button class="order-button" data-template="${key}" ${editing ? "" : "disabled"}><strong>${template.name}</strong><span>${template.description}</span></button>`).join("")}</div><p class="disclaimer">Templates are documentation aids only. Review each entry and make independent clinical decisions before saving or prescribing.</p></div></div>
            </aside>
          </div>`;
      }

      function renderPrescriptions() {
        const patient = patientById(state.selectedRxPatientId) || selectedPatient();
        if (patient) state.selectedRxPatientId = patient.id;
        const patientOptions = state.patients.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === patient?.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
        const medications = patient?.medications || [];
        const profile = state.profile;
        $("#tab-prescriptions").innerHTML = `
          ${pageHeading("Medication management", "Prescriptions", "Prepare, review, and print a patient-specific e-prescription.", `<button class="button" data-action="add-medication">＋ Add medication</button><button class="button primary" data-action="print-rx" ${patient ? "" : "disabled"}>Print prescription</button>`)}
          <div class="workspace-layout">
            <div class="panel">
              <div class="panel-head"><div><h2 class="panel-title">Prescription details</h2><p class="panel-description">The preview includes your saved clinic identity and signature.</p></div><span class="badge neutral">Draft</span></div>
              <div class="panel-body">
                ${patient ? `<div class="form-grid" style="margin-bottom:20px">
                  <div class="field"><label for="rx-patient">Patient</label><select id="rx-patient">${patientOptions}</select></div>
                  <div class="field"><label>Visit complaint</label><input value="${escapeHtml(patient.complaint)}" readonly></div>
                </div>
                <div class="rx-header"><span>Medication</span><span>Strength / dose</span><span>Frequency</span><span>Duration</span><span></span></div>
                <div class="rx-editor" id="rx-editor">${medications.length ? medications.map((med, index) => renderMedicationRow(med, index)).join("") : `<div class="empty-state"><strong>No medications added</strong><span>Add a medication to prepare a prescription.</span></div>`}</div>
                <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="button primary" data-action="save-rx">Save prescription</button></div>` : `<div class="empty-state"><strong>No patient selected</strong><span>Check in a patient to prepare a prescription.</span><div style="margin-top:12px"><button class="button primary" data-action="go-checkin">Check in patient</button></div></div>`}
                <p class="disclaimer">Drafts are not transmitted to a pharmacy. Verify patient identity, medication, dose, route, frequency, duration, allergies, and local prescribing requirements before signing.</p>
              </div>
            </div>
            <aside class="panel"><div class="panel-head"><div><h2 class="panel-title">Prescriber</h2><p class="panel-description">Doctor identity on printed forms</p></div></div><div class="panel-body">
              <strong>${escapeHtml(profile.fullName || "Doctor name not set")}</strong><div class="patient-meta">${escapeHtml(profile.specialty || "Specialty not set")}</div>
              <div class="cell-muted" style="margin-top:14px">LICENSE</div><div style="margin-top:4px">${escapeHtml(profile.license || "Not provided")}</div>
              <div class="cell-muted" style="margin-top:12px">CLINIC</div><div style="margin-top:4px">${escapeHtml(profile.clinicName || "Not provided")}</div>
              ${profile.signature ? `<div class="cell-muted" style="margin-top:15px">SAVED SIGNATURE</div><img class="signature-preview" src="${profile.signature}" alt="Saved doctor signature">` : `<div class="info-callout" style="margin-top:14px">Add a signature in Doctor profile to include it on printable prescriptions.</div>`}
              <button class="button small" style="margin-top:14px" data-action="go-profile">Edit doctor profile</button>
            </div></aside>
          </div>`;
      }

      function renderMedicationRow(medication, index) {
        return `<div class="rx-row" data-medication-index="${index}">
          <input data-med-field="name" aria-label="Medication name" placeholder="Medication name" value="${escapeHtml(medication.name)}">
          <input data-med-field="dose" aria-label="Strength or dose" placeholder="e.g. 10 mg" value="${escapeHtml(medication.dose)}">
          <input data-med-field="frequency" aria-label="Frequency" placeholder="e.g. Once daily" value="${escapeHtml(medication.frequency)}">
          <input data-med-field="duration" aria-label="Duration" placeholder="e.g. 7 days" value="${escapeHtml(medication.duration)}">
          <button class="remove-med" data-action="remove-medication" data-index="${index}" aria-label="Remove medication">×</button>
        </div>`;
      }

      function renderProfile() {
        const profile = state.profile;
        const displayedProfile = profileEditing ? profileDraft : profile;
        const profileFieldsDisabled = profileEditing ? "" : "disabled";
        const profileHasChanges = profileEditing && Object.keys(profile).some((field) => displayedProfile[field] !== profile[field]);
        $("#tab-profile").innerHTML = `
          ${pageHeading("Practice settings", "Doctor profile", "Your saved identity appears on official printable forms.", profileEditing
            ? `<button class="button" data-action="cancel-profile-edit">Cancel</button><button class="button primary" data-action="save-profile" ${profileHasChanges ? "" : "disabled"}>Save</button>`
            : `<button class="button primary" data-action="edit-profile">Edit profile</button>`)}
          <div class="profile-layout">
            <div class="panel"><div class="panel-head"><div><h2 class="panel-title">Professional details</h2><p class="panel-description">${profileEditing ? "Edit your details, then save or cancel your changes." : "Your saved details appear on official printable forms."}</p></div></div>
              <div class="panel-body">
                <div class="profile-top">${displayedProfile.photo ? `<img class="profile-photo" id="photo-preview" src="${displayedProfile.photo}" alt="Doctor profile photo">` : `<div class="profile-photo" id="photo-preview">${escapeHtml(initials(displayedProfile.fullName))}</div>`}<div class="field"><label for="photo-upload">Profile picture</label><input type="file" id="photo-upload" accept=".png,.jpg,.jpeg,image/png,image/jpeg" ${profileFieldsDisabled}><span class="field-hint">PNG or JPEG, up to 2 MB. Stored in this browser only.</span></div></div>
                <div class="form-grid">
                  <div class="field"><label for="profile-name">Full name</label><input id="profile-name" data-profile-field="fullName" autocomplete="name" value="${escapeHtml(displayedProfile.fullName)}" placeholder="Dr. Alex Morgan" ${profileFieldsDisabled}></div>
                  <div class="field"><label for="profile-license">Medical license #</label><input id="profile-license" data-profile-field="license" value="${escapeHtml(displayedProfile.license)}" placeholder="License number" ${profileFieldsDisabled}></div>
                  <div class="field"><label for="profile-specialty">Specialty</label><input id="profile-specialty" data-profile-field="specialty" value="${escapeHtml(displayedProfile.specialty)}" placeholder="Family medicine" ${profileFieldsDisabled}></div>
                  <div class="field"><label for="profile-clinic">Clinic name</label><input id="profile-clinic" data-profile-field="clinicName" value="${escapeHtml(displayedProfile.clinicName)}" placeholder="Clinic name" ${profileFieldsDisabled}></div>
                  <div class="field"><label for="profile-contact">Contact information</label><input id="profile-contact" data-profile-field="contact" value="${escapeHtml(displayedProfile.contact)}" placeholder="Phone or email" ${profileFieldsDisabled}></div>
                  <div class="field full"><label for="profile-bio">Brief bio</label><textarea id="profile-bio" data-profile-field="bio" placeholder="A brief professional introduction..." ${profileFieldsDisabled}>${escapeHtml(displayedProfile.bio)}</textarea></div>
                </div>
                <div class="field" style="margin-top:23px"><label for="sync-endpoint">Trusted sync endpoint (optional)</label><input id="sync-endpoint" data-profile-field="syncEndpoint" type="url" autocomplete="url" value="${escapeHtml(displayedProfile.syncEndpoint)}" placeholder="https://your-clinic.example/api/sync" ${profileFieldsDisabled}><span class="field-hint">Patient records are sensitive. Use only an authenticated, encrypted endpoint you control. Payloads are sent only after configuring this URL.</span></div>
              </div>
            </div>
            <div class="panel"><div class="panel-head"><div><h2 class="panel-title">Digital signature</h2><p class="panel-description">Draw with a mouse, stylus, or touch.</p></div></div><div class="panel-body">
              <canvas id="signature-canvas" class="signature-canvas" aria-label="Draw your digital signature"></canvas>
              <div class="signature-actions"><button class="button small" data-action="clear-signature">Clear pad</button><button class="button primary small" data-action="save-signature">Save signature</button></div>
              ${profile.signature ? `<div style="margin-top:18px"><div class="field-hint">Saved signature · embedded on printable prescriptions</div><img class="signature-preview" src="${profile.signature}" alt="Saved digital signature"><button class="button danger small" style="margin-top:10px" data-action="remove-signature">Remove signature</button></div>` : `<p class="field-hint" style="margin-top:13px">No signature saved yet.</p>`}
              <p class="disclaimer">A drawn signature is an image, not a verified electronic signature. Follow applicable identity, consent, privacy, and prescribing rules.</p>
            </div></div>
          </div>`;
        initSignatureCanvas();
      }

      function renderSync() {
        const current = isOnline();
        const endpointReady = Boolean(state.profile.syncEndpoint.trim());
        $("#tab-sync").innerHTML = `
          ${pageHeading("Data & connectivity", "Sync logs", "Review local saves, connectivity, and remote delivery.", `<button class="button primary" data-action="sync-now" ${!current || !endpointReady || syncInFlight || !state.pendingActions.length ? "disabled" : ""}>${syncInFlight ? "Syncing…" : "Sync now"}</button>`)}
          <div class="profile-layout">
            <div class="panel"><div class="panel-head"><div><h2 class="panel-title">Activity</h2><p class="panel-description">Newest activity appears first. Patient details are not included in this log.</p></div>${badge(`${state.pendingActions.length} pending`)}</div>
              ${state.logs.length ? `<div class="table-wrap"><table class="log-table"><thead><tr><th>Time</th><th>Activity</th><th>Result</th></tr></thead><tbody>${state.logs.map((entry) => `<tr><td>${formatDateTime(entry.time)}</td><td>${escapeHtml(entry.message)}</td><td>${badge(entry.result === "synced" ? "Synced" : entry.result === "pending" ? "Pending" : entry.result === "conflict" ? "Conflict" : entry.result === "error" ? "Error" : "Info")}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><strong>No activity yet</strong><span>Local saves and sync attempts will appear here.</span></div>`}
            </div>
            <aside class="panel"><div class="panel-head"><div><h2 class="panel-title">Connection & sync</h2><p class="panel-description">Local-first · remote sync is optional</p></div></div><div class="panel-body">
              <div class="sync-status"><span class="sync-status-icon">${current ? "●" : "◌"}</span><div><strong>${current ? "Device appears online" : "Offline mode"}</strong><span>${current ? (endpointReady ? "Pending changes will be sent to your configured endpoint." : "Changes stay on this device until a trusted endpoint is configured.") : "All clinic actions continue to work and save on this device."}</span></div></div>
              <div class="field"><label>Network test override</label><button class="button" style="width:100%;text-align:left;margin-top:2px" data-action="toggle-network">${state.syncOverride === true ? "✓ Force online · click to use device status" : state.syncOverride === false ? "✓ Force offline · click to use device status" : "Use actual network status"}</button><span class="field-hint">Test offline behavior without disconnecting the device.</span></div>
              <div class="field" style="margin-top:17px"><label for="sync-policy">Conflict policy</label><input id="sync-policy" value="Local edits take precedence; server conflicts are retained for manual review." readonly><span class="field-hint">Every queued change has a timestamp and remains available locally if delivery fails.</span></div>
              <div class="info-callout" style="margin-top:16px">${endpointReady ? `Configured endpoint: <strong>${escapeHtml(state.profile.syncEndpoint)}</strong>. Changes are sent using HTTPS POST only while online.` : "No remote endpoint configured. Nothing is sent over the network; your data remains in browser storage."} Browser storage is not encrypted by this app. Use a secured device and a suitable clinical data system.</div>
            </div></aside>
          </div>`;
      }

      function renderTab(tab = activeTab) {
        activeTab = tab;
        document.querySelectorAll(".tab-panel").forEach((panel) => { panel.hidden = panel.id !== `tab-${tab}`; });
        document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
        if (tab === "queue") renderQueue();
        if (tab === "checkin") renderCheckin();
        if (tab === "soap") renderSoap();
        if (tab === "patient-records") renderPatientRecords();
        if (tab === "prescriptions") renderPrescriptions();
        if (tab === "profile") renderProfile();
        if (tab === "sync") renderSync();
        renderHeader();
      }

      function navigate(tab, patientId) {
        if (tab === "soap" && patientId && soapDraft && soapDraft.patientId !== patientId) {
          toast("Save or cancel the current SOAP draft before opening another patient's chart.", true);
          return;
        }
        if (patientId) {
          setActivePatient(patientId);
          if (tab === "prescriptions") state.selectedRxPatientId = patientId;
        }
        renderTab(tab);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }

      function updateSoap(field, value) {
        const patient = selectedPatient();
        if (!patient || !soapDraft || soapDraft.patientId !== patient.id || !Object.hasOwn(soapDraft.soap, field)) return;
        soapDraft.soap[field] = value;
        const hasChanges = JSON.stringify(soapDraft.soap) !== JSON.stringify(patient.soap || {}) ||
          JSON.stringify(soapDraft.medications) !== JSON.stringify(patient.medications || []);
        document.querySelectorAll('[data-action="save-soap"]').forEach((button) => { button.disabled = !hasChanges; });
      }

      function updateMedication(index, field, value) {
        const patient = patientById(state.selectedRxPatientId);
        if (!patient) return;
        patient.medications ||= [];
        if (!patient.medications[index]) return;
        patient.medications[index][field] = value;
        saveLocal();
        clearTimeout(medicationSaveTimer);
        medicationSaveTimer = setTimeout(() => {
          state.pendingActions.push({ id: id(), entityId: patient.id, action: "prescription-save", timestamp: now(), details: { medicationIndex: index }, resolution: "local-wins" });
          addLog("prescription-save", "Prescription saved on this device.", "pending");
          saveLocal(); renderHeader(); trySync();
        }, 900);
      }

      function updateProfileField(field, value) {
        if (!profileEditing || !profileDraft || !Object.hasOwn(profileDraft, field)) return;
        profileDraft[field] = value;
        if (field === "fullName") {
          const photoPreview = $("#photo-preview");
          if (photoPreview && photoPreview.tagName !== "IMG") photoPreview.textContent = initials(value);
        }
        const hasChanges = Object.keys(state.profile).some((key) => profileDraft[key] !== state.profile[key]);
        const saveButton = $('[data-action="save-profile"]');
        if (saveButton) saveButton.disabled = !hasChanges;
      }

      function saveProfile() {
        if (!profileEditing || !profileDraft) return;
        const endpoint = profileDraft.syncEndpoint.trim();
        if (endpoint) {
          try {
            const url = new URL(endpoint);
            if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
              toast("Sync endpoint must use HTTPS, except on localhost.", true);
              return;
            }
          } catch {
            toast("Enter a valid sync endpoint URL, or leave the field empty.", true);
            $("#sync-endpoint")?.focus();
            return;
          }
        }
        const changedFields = Object.keys(state.profile).filter((field) => profileDraft[field] !== state.profile[field]);
        if (!changedFields.length) return;
        state.profile = { ...profileDraft };
        profileEditing = false;
        profileDraft = null;
        commitMutation("profile-update", "doctor-profile", { fields: changedFields }, true);
        renderHeader();
        renderProfile();
        if (activeTab === "prescriptions") renderPrescriptions();
        toast("Doctor profile saved on this device.");
      }

      function applyTemplate(templateKey) {
        const patient = selectedPatient();
        const template = TEMPLATES[templateKey];
        if (!patient || !template) return;
        if (!soapDraft || soapDraft.patientId !== patient.id) {
          toast("Edit the SOAP note before applying an order set.", true);
          return;
        }
        soapDraft.soap = { ...soapDraft.soap, ...template.soap };
        soapDraft.medications = template.medications.map((medication) => ({ ...medication }));
        renderSoap();
        toast(`${template.name} added to the draft. Review and save to keep it.`);
      }

      function startSoapEdit() {
        const patient = selectedPatient();
        if (!patient) return;
        if (soapDraft && soapDraft.patientId !== patient.id) {
          toast("Save or cancel the other patient's note before editing this one.", true);
          return;
        }
        const soap = patient.soap || { subjective: "", objective: "", assessment: "", plan: "" };
        soapDraft = {
          patientId: patient.id,
          soap: { ...soap },
          medications: (patient.medications || []).map((medication) => ({ ...medication }))
        };
        renderSoap();
      }

      function cancelSoapEdit() {
        if (!soapDraft) return;
        soapDraft = null;
        renderSoap();
        toast("SOAP note changes discarded.");
      }

      function saveSoap() {
        const patient = selectedPatient();
        if (!patient || !soapDraft || soapDraft.patientId !== patient.id) {
          toast("Edit a patient's note before saving.", true);
          return;
        }
        const soapHasChanges = JSON.stringify(soapDraft.soap) !== JSON.stringify(patient.soap || {}) ||
          JSON.stringify(soapDraft.medications) !== JSON.stringify(patient.medications || []);
        if (!soapHasChanges) return;
        patient.soap = { ...soapDraft.soap };
        patient.medications = soapDraft.medications.map((medication) => ({ ...medication }));
        const medicationCount = patient.medications.length;
        soapDraft = null;
        commitMutation("soap-save", patient.id, { section: "all", medicationCount }, true);
        renderSoap();
        toast("SOAP note saved on this device.");
      }

      function addMedication() {
        const patient = patientById(state.selectedRxPatientId) || selectedPatient();
        if (!patient) return;
        state.selectedRxPatientId = patient.id;
        patient.medications ||= [];
        patient.medications.push({ name: "", dose: "", frequency: "", duration: "" });
        commitMutation("prescription-edit", patient.id, { change: "add-medication" });
        renderPrescriptions();
        const inputs = document.querySelectorAll("#rx-editor [data-med-field='name']");
        inputs[inputs.length - 1]?.focus();
      }

      async function readProfilePhoto(file) {
        if (!file) return;
        if (!profileEditing || !profileDraft) {
          toast("Select Edit profile before changing the profile picture.", true);
          return;
        }
        if (!["image/png", "image/jpeg"].includes(file.type)) {
          toast("Choose a PNG or JPEG image.", true);
          return;
        }
        if (file.size > 2 * 1024 * 1024) {
          toast("Choose an image smaller than 2 MB.", true);
          return;
        }
        const reader = new FileReader();
        reader.addEventListener("load", () => {
          if (typeof reader.result !== "string" || !reader.result.startsWith("data:image/")) {
            toast("The image could not be read.", true);
            return;
          }
          profileDraft.photo = reader.result;
          renderProfile();
          toast("Profile picture added to your draft. Save the profile to keep it.");
        });
        reader.addEventListener("error", () => toast("Could not read the selected image.", true), { once: true });
        reader.readAsDataURL(file);
      }

      function initSignatureCanvas() {
        const canvas = $("#signature-canvas");
        if (!canvas) return;
        canvasContext = canvas.getContext("2d", { willReadFrequently: true });
        if (!canvasContext) {
          toast("Your browser does not support the signature canvas.", true);
          return;
        }
        const resize = () => {
          const oldSignature = canvas.toDataURL("image/png");
          const rect = canvas.getBoundingClientRect();
          if (!rect.width || !rect.height) return;
          const scale = Math.max(1, window.devicePixelRatio || 1);
          canvas.width = Math.round(rect.width * scale);
          canvas.height = Math.round(rect.height * scale);
          canvasContext.setTransform(scale, 0, 0, scale, 0, 0);
          canvasContext.lineWidth = 2;
          canvasContext.lineCap = "round";
          canvasContext.lineJoin = "round";
          canvasContext.strokeStyle = "#183447";
          if (state.profile.signature) drawImageOnCanvas(canvas, state.profile.signature);
          else if (oldSignature && oldSignature !== "data:,") drawImageOnCanvas(canvas, oldSignature);
        };
        resize();
        if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(canvas);
        else window.addEventListener("resize", resize);
        const pointFrom = (event) => {
          const rect = canvas.getBoundingClientRect();
          return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        };
        const start = (point) => { drawing = true; activePoint = point; };
        const move = (point) => {
          if (!drawing || !activePoint) return;
          canvasContext.beginPath();
          canvasContext.moveTo(activePoint.x, activePoint.y);
          canvasContext.lineTo(point.x, point.y);
          canvasContext.stroke();
          activePoint = point;
        };
        const end = () => { drawing = false; activePoint = null; };
        canvas.addEventListener("mousedown", (event) => {
          if (Date.now() < suppressMouseUntil) return;
          start(pointFrom(event));
        });
        canvas.addEventListener("mousemove", (event) => move(pointFrom(event)));
        canvas.addEventListener("mouseup", end);
        canvas.addEventListener("mouseleave", end);
        canvas.addEventListener("touchstart", (event) => {
          event.preventDefault();
          suppressMouseUntil = Date.now() + 800;
          const touch = event.changedTouches[0];
          if (touch) start(pointFrom(touch));
        }, { passive: false });
        canvas.addEventListener("touchmove", (event) => {
          event.preventDefault();
          const touch = event.changedTouches[0];
          if (touch) move(pointFrom(touch));
        }, { passive: false });
        canvas.addEventListener("touchend", end);
        canvas.addEventListener("touchcancel", end);
      }

      function drawImageOnCanvas(canvas, dataUrl) {
        const image = new Image();
        image.addEventListener("load", () => {
          const rect = canvas.getBoundingClientRect();
          const scale = Math.min(rect.width / image.width, rect.height / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          canvas.getContext("2d")?.drawImage(image, (rect.width - width) / 2, (rect.height - height) / 2, width, height);
        }, { once: true });
        image.src = dataUrl;
      }

      function saveSignature() {
        const canvas = $("#signature-canvas");
        if (!canvas) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        const { width, height } = canvas;
        const pixels = context.getImageData(0, 0, width, height).data;
        let hasInk = false;
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) { hasInk = true; break; }
        if (!hasInk) {
          toast("Draw a signature before saving.", true);
          return;
        }
        try {
          state.profile.signature = canvas.toDataURL("image/png");
        } catch (error) {
          toast(`Could not save the signature: ${error.message}`, true);
          return;
        }
        commitMutation("profile-signature", "doctor-profile", { format: "image/png" });
        renderProfile();
        toast("Signature saved on this device.");
      }

      function renderPrintSheet(patient) {
        const profile = state.profile;
        const medications = (patient.medications || []).filter((medication) => medication.name.trim());
        const signature = profile.signature ? `<img src="${profile.signature}" alt="Doctor signature">` : "<div>Prescriber signature</div>";
        $("#print-sheet").innerHTML = `
          <div class="print-top"><div><div class="print-kicker">${escapeHtml(profile.clinicName || "Clinic")}</div><h1>Prescription</h1>${profile.contact ? `<div>${escapeHtml(profile.contact)}</div>` : ""}</div>
          <div class="print-doctor"><strong>${escapeHtml(profile.fullName || "Prescriber")}</strong><div>${escapeHtml(profile.specialty)}</div><div>License: ${escapeHtml(profile.license || "Not provided")}</div></div></div>
          <div class="print-patient"><strong>${escapeHtml(patient.name)}</strong><div>${escapeHtml(patient.age ? `${patient.age} years old` : "Age not recorded")}${patient.sex ? ` · ${escapeHtml(patient.sex)}` : ""}</div><div>Phone: ${escapeHtml(patient.phone || "Not provided")}</div><div>Date: ${escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date()))}</div></div>
          <div class="print-label">Medications</div>
          ${medications.length ? `<table class="print-medications"><thead><tr><th>Medication</th><th>Strength / dose</th><th>Frequency</th><th>Duration</th></tr></thead><tbody>${medications.map((medication) => `<tr><td>${escapeHtml(medication.name)}</td><td>${escapeHtml(medication.dose || "—")}</td><td>${escapeHtml(medication.frequency || "—")}</td><td>${escapeHtml(medication.duration || "—")}</td></tr>`).join("")}</tbody></table>` : "<p>No medications entered.</p>"}
          ${patient.complaint ? `<div class="print-label">Visit note</div><div>${escapeHtml(patient.complaint)}</div>` : ""}
          <div class="print-signature">${signature}</div>`;
      }

      function printPrescription() {
        const patient = patientById(state.selectedRxPatientId) || selectedPatient();
        if (!patient) {
          toast("Select a patient before printing.", true);
          return;
        }
        renderPrintSheet(patient);
        window.print();
      }

      async function trySync() {
        const endpoint = state.profile.syncEndpoint.trim();
        if (!isOnline() || !endpoint || !state.pendingActions.length || syncInFlight || syncRetryBlocked) return;
        let target;
        try {
          target = new URL(endpoint, window.location.href);
          if (target.protocol !== "https:" && target.hostname !== "localhost" && target.hostname !== "127.0.0.1") {
            toast("Sync endpoint must use HTTPS, except on localhost.", true);
            addLog("sync-error", "Sync paused: the configured endpoint does not use HTTPS.", "error");
            saveLocal(); renderHeader();
            return;
          }
        } catch {
          toast("Enter a valid sync endpoint URL in Doctor profile.", true);
          addLog("sync-error", "Sync paused: the configured endpoint URL is invalid.", "error");
          saveLocal(); renderHeader();
          return;
        }
        syncInFlight = true;
        if (activeTab === "sync") renderSync();
        const batch = state.pendingActions.slice(0, 50);
        try {
          const response = await fetch(target.href, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify({
              version: 1,
              conflictPolicy: "local-wins",
              actions: batch.map((action) => ({
                ...action,
                record: action.entityId === "doctor-profile" ? state.profile : patientById(action.entityId) || null
              }))
            })
          });
          if (response.status === 409) {
            syncRetryBlocked = true;
            addLog("sync-conflict", "Server reported a conflict; local edits were preserved for manual review.", "conflict");
            toast("A sync conflict needs review. Local changes are preserved.", true);
          } else if (!response.ok) {
            throw new Error(`Sync endpoint returned HTTP ${response.status}.`);
          } else {
            const deliveredIds = new Set(batch.map((action) => action.id));
            state.pendingActions = state.pendingActions.filter((action) => !deliveredIds.has(action.id));
            addLog("sync-success", `${batch.length} queued ${batch.length === 1 ? "change" : "changes"} acknowledged by the configured endpoint.`, "synced");
            if (state.pendingActions.length) setTimeout(trySync, 0);
          }
        } catch (error) {
          syncRetryBlocked = true;
          addLog("sync-error", `Remote sync failed: ${error.message}`, "error");
          toast("Remote sync failed. Changes remain saved locally; check Sync logs.", true);
        } finally {
          syncInFlight = false;
          saveLocal();
          renderHeader();
          if (activeTab === "sync") renderSync();
        }
      }

      function syncNow() {
        syncRetryBlocked = false;
        trySync();
      }

      document.addEventListener("click", (event) => {
        const target = event.target.closest("[data-tab], [data-action], [data-filter], [data-template], [data-chart-range]");
        if (!target) return;
        if (target.dataset.tab) { navigate(target.dataset.tab); return; }
        if (target.dataset.filter) { queueFilter = target.dataset.filter; renderQueue(); return; }
        if (target.dataset.chartRange) {
          const range = Number(target.dataset.chartRange);
          if ([7, 14, 30].includes(range)) {
            analyticsRange = range;
            renderPatientRecords();
          }
          return;
        }
        if (target.dataset.template) { applyTemplate(target.dataset.template); return; }
        switch (target.dataset.action) {
          case "edit-soap": startSoapEdit(); break;
          case "cancel-soap": cancelSoapEdit(); break;
          case "edit-profile":
            profileDraft = { ...state.profile };
            profileEditing = true;
            renderProfile();
            $("#profile-name")?.focus();
            break;
          case "cancel-profile-edit":
            profileEditing = false;
            profileDraft = null;
            renderProfile();
            toast("Profile edits discarded.");
            break;
          case "save-profile": saveProfile(); break;
          case "go-checkin": navigate("checkin"); break;
          case "go-profile": navigate("profile"); break;
          case "open-soap": navigate("soap", target.dataset.patientId); break;
          case "record-open-soap": navigate("soap", target.dataset.patientId); break;
          case "record-open-rx": navigate("prescriptions", target.dataset.patientId); break;
          case "export-patient-workbook": exportPatientWorkbook(); break;
          case "save-soap": saveSoap(); break;
          case "add-medication": addMedication(); break;
          case "remove-medication": {
            const patient = patientById(state.selectedRxPatientId);
            const index = Number(target.dataset.index);
            if (patient?.medications?.[index]) {
              patient.medications.splice(index, 1);
              commitMutation("prescription-edit", patient.id, { change: "remove-medication", index });
              renderPrescriptions();
            }
            break;
          }
          case "save-rx": {
            const patient = patientById(state.selectedRxPatientId);
            if (!patient) { toast("Select a patient before saving a prescription.", true); break; }
            state.pendingActions.push({ id: id(), entityId: patient.id, action: "prescription-save", timestamp: now(), details: { medicationCount: (patient.medications || []).length }, resolution: "local-wins" });
            addLog("prescription-save", "Prescription saved on this device.", "pending");
            saveLocal(); renderHeader(); trySync(); toast("Prescription saved on this device.");
            break;
          }
          case "print-rx": printPrescription(); break;
          case "clear-signature": {
            const canvas = $("#signature-canvas");
            canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
            break;
          }
          case "save-signature": saveSignature(); break;
          case "remove-signature":
            state.profile.signature = "";
            commitMutation("profile-signature-removed", "doctor-profile", {});
            renderProfile(); toast("Saved signature removed.");
            break;
          case "toggle-network":
            state.syncOverride = state.syncOverride === null ? !actualOnline : null;
            saveLocal(); renderHeader(); renderSync();
            if (isOnline()) { syncRetryBlocked = false; trySync(); }
            break;
          case "sync-now": syncNow(); break;
        }
      });

      document.addEventListener("input", (event) => {
        const target = event.target;
        if (target.closest("#checkin-form")) {
          const draftData = new FormData($("#checkin-form"));
          state.intakeDraft = Object.fromEntries(draftData.entries());
          saveLocal();
        } else if (target.id === "queue-search") {
          const position = target.selectionStart;
          searchQuery = target.value;
          renderQueue();
          const replacement = $("#queue-search");
          replacement?.focus();
          replacement?.setSelectionRange(position, position);
        } else if (target.matches("[data-soap-field]")) {
          updateSoap(target.dataset.soapField, target.value);
        } else if (target.matches("[data-profile-field]")) {
          updateProfileField(target.dataset.profileField, target.value);
        } else if (target.matches("[data-med-field]")) {
          const row = target.closest("[data-medication-index]");
          if (row) updateMedication(Number(row.dataset.medicationIndex), target.dataset.medField, target.value);
        }
      });

      document.addEventListener("change", (event) => {
        const target = event.target;
        if (target.closest("#checkin-form")) {
          const draftData = new FormData($("#checkin-form"));
          state.intakeDraft = Object.fromEntries(draftData.entries());
          saveLocal();
        } else if (target.matches("[data-status-id]")) {
          const patient = patientById(target.dataset.statusId);
          if (!patient || !STATUS.includes(target.value)) return;
          patient.status = target.value;
          commitMutation("queue-status", patient.id, { status: patient.status }, true);
          renderQueue();
          toast(`${patient.name} marked ${patient.status.toLowerCase()}.`);
        } else if (target.id === "soap-patient") {
          setActivePatient(target.value); renderSoap();
        } else if (target.id === "rx-patient") {
          state.selectedRxPatientId = target.value; saveLocal(); renderPrescriptions();
        } else if (target.id === "photo-upload") {
          void readProfilePhoto(target.files?.[0]);
        }
      });

      document.addEventListener("submit", (event) => {
        if (event.target.id !== "checkin-form") return;
        event.preventDefault();
        const formData = new FormData(event.target);
        const get = (name) => String(formData.get(name) || "").trim();
        const patient = makeDemoPatient({
          name: get("name"), phone: get("phone"), age: get("age"), sex: get("sex"), complaint: get("complaint"),
          triage: get("triage") || "Routine",
          vitals: {
            bloodPressure: get("bloodPressure"), pulse: get("pulse"), temperature: get("temperature"),
            height: get("height"), weight: get("weight")
          }
        });
        state.patients.unshift(patient);
        state.intakeDraft = {};
        state.activePatientId = patient.id;
        state.selectedRxPatientId = patient.id;
        commitMutation("patient-checkin", patient.id, { createdAt: patient.createdAt }, true);
        toast(`${patient.name} added to the queue.`);
        navigate("queue");
      });

      document.addEventListener("reset", (event) => {
        if (event.target.id !== "checkin-form") return;
        state.intakeDraft = {};
        saveLocal();
      });

      window.addEventListener("online", () => {
        actualOnline = true;
        renderHeader();
        addLog("network-online", "Device network connection restored.", "info");
        saveLocal();
        if (isOnline()) { syncRetryBlocked = false; trySync(); }
        if (activeTab === "sync") renderSync();
      });
      window.addEventListener("offline", () => {
        actualOnline = false;
        renderHeader();
        addLog("network-offline", "Device is offline. Clinic actions remain available locally.", "info");
        saveLocal();
        if (activeTab === "sync") renderSync();
      });
      window.addEventListener("storage", (event) => {
        if (event.key !== STORAGE_KEY || !event.newValue) return;
        try {
          const incoming = JSON.parse(event.newValue);
          if (incoming?.version !== 1 || !Array.isArray(incoming.patients)) return;
          const localPendingIds = new Set(state.pendingActions.map((action) => action.id));
          const remotePending = (incoming.pendingActions || []).filter((action) => !localPendingIds.has(action.id));
          const localPatientIds = new Set(state.patients.map((patient) => patient.id));
          const incomingPatients = incoming.patients.filter((patient) => !localPatientIds.has(patient.id));
          state.patients.push(...incomingPatients);
          state.pendingActions.push(...remotePending);
          state.profile = { ...state.profile, ...incoming.profile };
          addLog("cross-tab-update", "New local changes received from another open clinic tab.", "info");
          saveLocal(); renderTab();
        } catch (error) {
          toast(`Could not receive an update from another tab: ${error.message}`, true);
        }
      });

      renderTab("queue");
      if (state.profile.syncEndpoint && isOnline() && state.pendingActions.length) trySync();
      setInterval(() => {
        if (activeTab === "patient-records") renderPatientRecords();
      }, 60_000);
    })();
