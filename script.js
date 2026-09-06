import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm";

const SUPABASE_URL = "https://nlepbxthswfdqlpjjatg.supabase.co";
const SUPABASE_KEY = "sb_publishable_vxz3JYjhD1GrlJNNUO63LA_iCoypa1z";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const state = { me: null, conversations: [], groups: [], active: null, channel: null };
const $ = (selector) => document.querySelector(selector);
const app = $("#appView");

function refreshIcons() { window.lucide?.createIcons(); }
function escapeHtml(value = "") { const node = document.createElement("div"); node.textContent = value; return node.innerHTML; }
function initials(name = "?") { return name.split(/[._ -]/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase(); }
function profileFromRow(row) { return { id: row.id, username: row.username, status: row.status || "", profileImage: row.profile_image || "" }; }
function avatar(user, size = "") { return user.profileImage ? `<img class="avatar ${size}" src="${user.profileImage}" alt="">` : `<span class="avatar ${size}">${escapeHtml(initials(user.username || user.name))}</span>`; }
function displayTime(value) { if (!value) return ""; const date = new Date(value); return date.toDateString() === new Date().toDateString() ? date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }); }
function toast(message) { const element = $("#toast"); element.textContent = message; element.classList.add("visible"); clearTimeout(window.toastTimeout); window.toastTimeout = setTimeout(() => element.classList.remove("visible"), 3600); }
function requireSuccess(result) { if (result.error) throw result.error; return result.data; }
function readableError(error) {
  if (error?.code === "23505") return "Dieser Benutzername ist bereits vergeben.";
  if (error?.message?.includes("Anonymous sign-ins")) return "Aktiviere in Supabase unter Authentication > Providers die Anonymous sign-ins.";
  if (error?.message?.includes("relation") || error?.code === "42P01") return "Supabase ist noch nicht eingerichtet. Fuehre zuerst supabase.sql im SQL Editor aus.";
  return error?.message || "Etwas ist schiefgelaufen.";
}

function showSetup() {
  state.channel?.unsubscribe();
  state.channel = null;
  state.me = null;
  state.active = null;
  app.classList.add("hidden");
  $("#authView").classList.remove("hidden");
  $("#loginUsername").focus();
}
function renderProfile() {
  $("#ownProfile").innerHTML = `${avatar(state.me, "large")}<div class="profile-copy"><strong>${escapeHtml(state.me.username)}</strong><span>${escapeHtml(state.me.status || "Online")}</span></div>`;
}
function showView(view) {
  document.querySelectorAll(".content-view").forEach((node) => node.classList.add("hidden"));
  $(`#${view}View`).classList.remove("hidden");
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  if (view === "chats") loadConversations().catch(showLoadError);
  if (view === "groups") loadGroups().catch(showLoadError);
}
function showLoadError(error) { toast(readableError(error)); }

async function boot() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return showSetup();
  const row = requireSuccess(await supabase.from("profiles").select("id,username,status,profile_image").eq("id", session.user.id).maybeSingle());
  if (!row) return showSetup();
  state.me = profileFromRow(row);
  $("#authView").classList.add("hidden");
  app.classList.remove("hidden");
  renderProfile();
  await loadConversations();
  connectRealtime();
  refreshIcons();
}
async function createProfile(event) {
  event.preventDefault();
  const username = $("#loginUsername").value.trim();
  const status = $("#loginStatus").value.trim();
  if (!/^[A-Za-z0-9_. -]{3,30}$/.test(username)) return toast("Der Name muss 3 bis 30 Zeichen haben.");
  try {
    let { data: { session }, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (!session) {
      const signedIn = await supabase.auth.signInAnonymously();
      if (signedIn.error) throw signedIn.error;
      session = signedIn.data.session;
    }
    if (!session) throw new Error("Anonyme Anmeldung konnte nicht gestartet werden.");
    const row = requireSuccess(await supabase.from("profiles").insert({ id: session.user.id, username, status }).select("id,username,status,profile_image").single());
    state.me = profileFromRow(row);
    $("#authView").classList.add("hidden");
    app.classList.remove("hidden");
    renderProfile();
    await loadConversations();
    connectRealtime();
  } catch (error) { toast(readableError(error)); }
}

async function loadConversations() {
  const memberships = requireSuccess(await supabase.from("chat_members").select("chat_id,last_read_at,chats!inner(id,kind,created_at)").eq("user_id", state.me.id));
  const directMemberships = memberships.filter((membership) => membership.chats.kind === "direct");
  state.conversations = await Promise.all(directMemberships.map((membership) => loadConversation(membership)));
  state.conversations = state.conversations.filter(Boolean).sort((first, second) => (second.lastMessage?.createdAt || second.createdAt).localeCompare(first.lastMessage?.createdAt || first.createdAt));
  renderConversations();
}
async function loadConversation(membership) {
  const members = requireSuccess(await supabase.from("chat_members").select("user_id,profiles!chat_members_user_id_fkey(id,username,status,profile_image)").eq("chat_id", membership.chat_id));
  const otherMember = members.find((member) => member.user_id !== state.me.id);
  if (!otherMember?.profiles) return null;
  const lastRows = requireSuccess(await supabase.from("messages").select("body,created_at,sender_id").eq("chat_id", membership.chat_id).order("created_at", { ascending: false }).limit(1));
  const { count: unreadCount, error: unreadError } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("chat_id", membership.chat_id).neq("sender_id", state.me.id).gt("created_at", membership.last_read_at);
  if (unreadError) throw unreadError;
  const last = lastRows[0];
  return { id: membership.chat_id, createdAt: membership.chats.created_at, other: profileFromRow(otherMember.profiles), unread: unreadCount || 0, lastMessage: last && { body: last.body, createdAt: last.created_at, senderId: last.sender_id } };
}
function renderConversations() {
  const container = $("#conversationList");
  if (!state.conversations.length) {
    container.innerHTML = `<p class="empty-state">Noch keine Nachrichten. Finde eine Person und starte ein Gespraech.</p>`;
    return;
  }
  container.innerHTML = state.conversations.map((chat) => `<button class="conversation-item ${state.active?.kind === "chat" && state.active.id === chat.id ? "active" : ""}" data-chat="${chat.id}">${avatar(chat.other)}<div class="item-copy"><div class="item-title-row"><strong>${escapeHtml(chat.other.username)}</strong><time>${displayTime(chat.lastMessage?.createdAt)}</time></div><span class="preview">${escapeHtml(chat.lastMessage?.body || "Noch keine Nachrichten")}</span></div>${chat.unread ? `<span class="unread-badge">${chat.unread}</span>` : ""}</button>`).join("");
  container.querySelectorAll("[data-chat]").forEach((button) => button.addEventListener("click", () => openChat(button.dataset.chat)));
}
async function openChat(chatId) {
  const chat = state.conversations.find((item) => item.id === chatId);
  if (!chat) return;
  state.active = { kind: "chat", id: chat.id, chatId: chat.id, title: chat.other.username, subtitle: chat.other.status || "Privater Chat", profileImage: chat.other.profileImage };
  await loadMessages();
  app.classList.add("chat-open");
  renderConversations();
}

async function searchPeople() {
  const query = $("#userSearch").value.trim();
  const container = $("#searchResults");
  if (query.length < 2) { container.className = "person-list empty-state"; container.textContent = "Gib mindestens zwei Zeichen ein."; return; }
  try {
    const rows = requireSuccess(await supabase.from("profiles").select("id,username,status,profile_image").ilike("username", `%${query.replace(/[%_]/g, "\\$&")}%`).neq("id", state.me.id).order("username").limit(30));
    container.className = "person-list";
    container.innerHTML = rows.length ? rows.map((row) => { const user = profileFromRow(row); return `<article class="person-item">${avatar(user)}<div class="item-copy"><strong>${escapeHtml(user.username)}</strong><span class="preview">${escapeHtml(user.status || "Online")}</span></div><button class="primary-button" data-user="${user.id}">Chat</button></article>`; }).join("") : `<p class="empty-state">Keine passenden Personen gefunden.</p>`;
    container.querySelectorAll("[data-user]").forEach((button) => button.addEventListener("click", () => createChat(button.dataset.user)));
  } catch (error) { toast(readableError(error)); }
}
async function createChat(userId) {
  try {
    const chatId = requireSuccess(await supabase.rpc("create_direct_chat", { target_user: userId }));
    await loadConversations();
    showView("chats");
    await openChat(chatId);
  } catch (error) { toast(readableError(error)); }
}

async function loadGroups() {
  const [groupRows, memberRows, requestRows] = await Promise.all([
    supabase.from("groups").select("id,chat_id,name,description,image,owner_id,created_at").order("created_at", { ascending: false }),
    supabase.from("group_members").select("group_id,role").eq("user_id", state.me.id),
    supabase.from("join_requests").select("group_id,status").eq("user_id", state.me.id)
  ]);
  const groups = requireSuccess(groupRows);
  const memberships = requireSuccess(memberRows);
  const requests = requireSuccess(requestRows);
  state.groups = groups.map((group) => ({ ...group, profileImage: group.image || "", isMember: Boolean(memberships.find((member) => member.group_id === group.id)), role: memberships.find((member) => member.group_id === group.id)?.role, requestStatus: requests.find((request) => request.group_id === group.id)?.status }));
  renderGroups();
}
function renderGroups() {
  const container = $("#groupList");
  if (!state.groups.length) { container.innerHTML = `<p class="empty-state">Noch keine Gruppe vorhanden. Erstelle die erste Gemeinschaft.</p>`; return; }
  container.innerHTML = state.groups.map((group) => `<article class="group-card">${avatar({ username: group.name, profileImage: group.profileImage })}<div class="item-copy"><strong>${escapeHtml(group.name)}</strong><p>${escapeHtml(group.description || "Private Gruppe")}</p></div>${group.isMember ? `<button class="primary-button" data-group="${group.id}">Oeffnen</button>` : group.requestStatus === "requested" ? `<span class="preview">Anfrage offen</span>` : `<button class="primary-button" data-join="${group.id}">Anfragen</button>`}</article>`).join("");
  container.querySelectorAll("[data-group]").forEach((button) => button.addEventListener("click", () => openGroup(button.dataset.group)));
  container.querySelectorAll("[data-join]").forEach((button) => button.addEventListener("click", () => joinGroup(button.dataset.join)));
}
async function joinGroup(groupId) {
  try {
    requireSuccess(await supabase.from("join_requests").insert({ group_id: groupId, user_id: state.me.id }));
    toast("Beitrittsanfrage wurde gesendet.");
    await loadGroups();
  } catch (error) { toast(readableError(error)); }
}
async function openGroup(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group?.isMember) return;
  state.active = { kind: "group", id: group.id, chatId: group.chat_id, title: group.name, subtitle: "Private Gruppe", profileImage: group.profileImage, description: group.description, role: group.role };
  await loadMessages();
  app.classList.add("chat-open");
}

async function loadMessages() {
  if (!state.active) return;
  const messages = requireSuccess(await supabase.from("messages").select("id,body,created_at,sender_id,profiles!messages_sender_id_fkey(username)").eq("chat_id", state.active.chatId).order("created_at"));
  await supabase.from("chat_members").update({ last_read_at: new Date().toISOString() }).eq("chat_id", state.active.chatId).eq("user_id", state.me.id);
  renderChat(messages.map((message) => ({ id: message.id, body: message.body, createdAt: message.created_at, senderId: message.sender_id, senderName: message.profiles?.username || "Unbekannt" })));
}
function renderChat(messages) {
  const active = state.active;
  $("#chatEmpty").classList.add("hidden");
  $("#activeChat").classList.remove("hidden");
  const manage = active.kind === "group" && ["owner", "admin"].includes(active.role) ? `<div class="header-tools"><button id="manageGroupButton" class="icon-button" title="Gruppe verwalten" aria-label="Gruppe verwalten"><i data-lucide="settings-2"></i></button></div>` : "";
  $("#chatHeader").innerHTML = `<button id="backButton" class="icon-button back-button" aria-label="Zurueck"><i data-lucide="arrow-left"></i></button>${avatar({ username: active.title, profileImage: active.profileImage }, "large")}<div><strong>${escapeHtml(active.title)}</strong><span>${escapeHtml(active.subtitle)}</span></div>${manage}`;
  const feed = $("#messages");
  feed.innerHTML = messages.map((message) => `<article class="message ${message.senderId === state.me.id ? "own" : ""}">${active.kind === "group" && message.senderId !== state.me.id ? `<span class="sender">${escapeHtml(message.senderName)}</span>` : ""}<p>${escapeHtml(message.body)}</p><time>${displayTime(message.createdAt)}</time></article>`).join("");
  feed.scrollTop = feed.scrollHeight;
  $("#messageInput").disabled = false;
  $("#backButton")?.addEventListener("click", () => app.classList.remove("chat-open"));
  $("#manageGroupButton")?.addEventListener("click", openManagement);
  refreshIcons();
}
async function sendMessage(event) {
  event.preventDefault();
  const input = $("#messageInput");
  const body = input.value.trim();
  if (!body || !state.active) return;
  try {
    requireSuccess(await supabase.from("messages").insert({ chat_id: state.active.chatId, sender_id: state.me.id, body }));
    input.value = "";
  } catch (error) { toast(readableError(error)); }
}

function imageAsDataUrl(input) {
  return new Promise((resolve, reject) => {
    const file = input.files[0];
    if (!file) return resolve("");
    if (file.size > 500000) return reject(new Error("Das Bild darf hoechstens 500 KB gross sein."));
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Das Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}
async function createGroup(event) {
  event.preventDefault();
  try {
    const groupId = requireSuccess(await supabase.rpc("create_group", { group_name: $("#groupName").value.trim(), group_description: $("#groupDescription").value.trim(), group_image: await imageAsDataUrl($("#groupImage")) }));
    event.target.reset();
    $("#groupDialog").close();
    await loadGroups();
    toast("Private Gruppe wurde erstellt.");
    await openGroup(groupId);
  } catch (error) { toast(readableError(error)); }
}
async function saveProfile(event) {
  event.preventDefault();
  try {
    const image = await imageAsDataUrl($("#profileImage"));
    const update = { status: $("#profileStatus").value.trim() };
    if (image) update.profile_image = image;
    const row = requireSuccess(await supabase.from("profiles").update(update).eq("id", state.me.id).select("id,username,status,profile_image").single());
    state.me = profileFromRow(row);
    renderProfile();
    $("#profileDialog").close();
    toast("Profil gespeichert.");
  } catch (error) { toast(readableError(error)); }
}
function openProfile() { $("#profileUsername").value = state.me.username; $("#profileStatus").value = state.me.status || ""; $("#profileImage").value = ""; $("#profileDialog").showModal(); }

async function openManagement() {
  const group = state.active;
  if (!group || group.kind !== "group") return;
  $("#manageTitle").textContent = group.title;
  $("#editGroupName").value = group.title;
  $("#editGroupDescription").value = group.description || "";
  $("#manageDialog").showModal();
  try {
    const [requestResult, memberResult] = await Promise.all([
      supabase.from("join_requests").select("id,user_id").eq("group_id", group.id).eq("status", "requested"),
      supabase.from("group_members").select("user_id,role").eq("group_id", group.id)
    ]);
    const requests = requireSuccess(requestResult);
    const members = requireSuccess(memberResult);
    const ids = [...new Set([...requests, ...members].map((item) => item.user_id))];
    const profiles = ids.length ? requireSuccess(await supabase.from("profiles").select("id,username").in("id", ids)) : [];
    const nameFor = (id) => profiles.find((profile) => profile.id === id)?.username || "Unbekannt";
    $("#requestList").innerHTML = requests.length ? requests.map((request) => `<div class="manage-row"><span>${escapeHtml(nameFor(request.user_id))}</span><button data-request="${request.id}" data-decision="accepted">Annehmen</button><button data-request="${request.id}" data-decision="declined">Ablehnen</button></div>`).join("") : `<small>Keine offenen Anfragen.</small>`;
    $("#memberList").innerHTML = members.map((member) => `<div class="manage-row"><span>${escapeHtml(nameFor(member.user_id))} <small>${member.role}</small></span>${member.role !== "owner" ? memberControls(member) : ""}</div>`).join("");
    $("#requestList").querySelectorAll("[data-request]").forEach((button) => button.addEventListener("click", () => decideRequest(button.dataset.request, button.dataset.decision)));
    $("#memberList").querySelectorAll("[data-member]").forEach((button) => button.addEventListener("click", () => changeMember(button.dataset.member, button.dataset.action)));
  } catch (error) { toast(readableError(error)); }
}
function memberControls(member) {
  const controls = [`<button data-member="${member.user_id}" data-action="remove">Entfernen</button>`];
  if (state.active.role === "owner") controls.push(`<button data-member="${member.user_id}" data-action="${member.role === "admin" ? "member" : "admin"}">${member.role === "admin" ? "Mitglied" : "Admin"}</button>`);
  return controls.join("");
}
async function decideRequest(requestId, decision) { try { requireSuccess(await supabase.rpc("accept_join_request", { request_id: requestId, accept_request: decision === "accepted" })); await loadGroups(); await openManagement(); } catch (error) { toast(readableError(error)); } }
async function changeMember(userId, action) { try { requireSuccess(await supabase.rpc("manage_group_member", { target_group: state.active.id, target_user: userId, member_action: action })); await openManagement(); } catch (error) { toast(readableError(error)); } }
async function saveGroupEdit(event) { event.preventDefault(); try { requireSuccess(await supabase.from("groups").update({ name: $("#editGroupName").value.trim(), description: $("#editGroupDescription").value.trim() }).eq("id", state.active.id)); state.active.title = $("#editGroupName").value.trim(); state.active.description = $("#editGroupDescription").value.trim(); await loadGroups(); await loadMessages(); toast("Gruppe aktualisiert."); } catch (error) { toast(readableError(error)); } }
async function removeGroup() { if (!state.active || !confirm("Diese Gruppe wirklich loeschen?")) return; try { requireSuccess(await supabase.from("groups").delete().eq("id", state.active.id)); $("#manageDialog").close(); state.active = null; $("#activeChat").classList.add("hidden"); $("#chatEmpty").classList.remove("hidden"); app.classList.remove("chat-open"); await loadGroups(); toast("Gruppe wurde geloescht."); } catch (error) { toast(readableError(error)); } }

function connectRealtime() {
  state.channel?.unsubscribe();
  state.channel = supabase.channel("connectchat-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, refreshData)
    .on("postgres_changes", { event: "*", schema: "public", table: "chat_members" }, refreshData)
    .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, refreshData)
    .on("postgres_changes", { event: "*", schema: "public", table: "join_requests" }, refreshData)
    .subscribe();
}
function refreshData() {
  clearTimeout(window.refreshDelay);
  window.refreshDelay = setTimeout(async () => {
    try {
      await Promise.all([loadConversations(), loadGroups()]);
      if (state.active) await loadMessages();
    } catch (error) { console.error(error); }
  }, 120);
}
function applyTheme() { document.body.classList.toggle("dark", localStorage.getItem("connectchat-theme") === "dark"); }

$("#loginForm").addEventListener("submit", createProfile);
$("#newChatButton").addEventListener("click", () => showView("people"));
$("#createGroupButton").addEventListener("click", () => $("#groupDialog").showModal());
$("#groupForm").addEventListener("submit", createGroup);
$("#profileButton").addEventListener("click", openProfile);
$("#profileForm").addEventListener("submit", saveProfile);
$("#messageForm").addEventListener("submit", sendMessage);
$("#editGroupForm").addEventListener("submit", saveGroupEdit);
$("#deleteGroupButton").addEventListener("click", removeGroup);
$("#userSearch").addEventListener("input", () => { clearTimeout(window.searchDelay); window.searchDelay = setTimeout(searchPeople, 250); });
$("#themeButton").addEventListener("click", () => { localStorage.setItem("connectchat-theme", document.body.classList.contains("dark") ? "light" : "dark"); applyTheme(); });
$("#logoutButton").addEventListener("click", async () => { await supabase.auth.signOut(); showSetup(); });
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
document.querySelectorAll(".close-modal").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));

applyTheme();
boot().catch((error) => { showSetup(); toast(readableError(error)); });
refreshIcons();