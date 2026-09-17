const peerConfig = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:global.stun.twilio.com:3478" },
      {
        urls: "turn:openrelay.metered.ca:80",
        username: "openrelayproject",
        credential: "openrelayproject"
      },
      {
        urls: "turn:openrelay.metered.ca:443",
        username: "openrelayproject",
        credential: "openrelayproject"
      }
    ]
  }
};

const WORDS = {
  food: ["Pizza", "Burger", "Ice cream", "Sushi", "Popcorn", "Pancakes", "Tacos", "Chocolate", "Donut", "French fries", "Watermelon", "Coffee"],
  animals: ["Penguin", "Elephant", "Giraffe", "Dolphin", "Kangaroo", "Panda", "Tiger", "Cat", "Dog", "Octopus", "Koala", "Lion"],
  travel: ["Airport", "Beach", "Hotel", "Passport", "Suitcase", "Cruise ship", "Mountain", "Theme park", "Train station", "Desert", "Island", "Road trip"],
  movies: ["Harry Potter", "Titanic", "The Lion King", "Frozen", "Spider-Man", "Jurassic Park", "Toy Story", "The Avengers", "Shrek", "Finding Nemo", "Wednesday", "Home Alone"],
  things: ["Umbrella", "Toothbrush", "Laptop", "Alarm clock", "Backpack", "Bicycle", "Candle", "Sunglasses", "Pillow", "Remote control", "Balloon", "Key"]
};
WORDS.mixed = [...WORDS.food, ...WORDS.animals, ...WORDS.travel, ...WORDS.movies, ...WORDS.things];

let peer = null, hostConn = null, host = false, roomId = "", me = "", myId = "";
let connections = {}, players = {}, game = {}, myVoteDone = false, timerInt = null, mySecret = null, lastPlayers = {};
let myGuessDone = false;

function stopTimer() {
  if (timerInt) {
    clearInterval(timerInt);
    timerInt = null;
  }
}

function show(id) {
  stopTimer();
  document.querySelectorAll("section").forEach((s) => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function toast(t) {
  const x = document.getElementById("toast");
  x.textContent = t;
  x.style.display = "block";
  setTimeout(() => (x.style.display = "none"), 2500);
}

function clean(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function makeCode() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

function createRoom() {
  host = true; myId = "host"; roomId = makeCode(); me = "Host";
  players = { host: { id: "host", name: "Host", isHost: true } };
  
  // Applied peerConfig here for room creation
  peer = new Peer("imposter-" + roomId.toLowerCase() + "-" + Math.random().toString(36).slice(2, 7), peerConfig);
  
  peer.on("open", () => {
    const link = location.href.split("?")[0] + "?room=" + encodeURIComponent(roomId) + "&host=" + encodeURIComponent(peer.id);
    document.getElementById("roomCode").textContent = roomId;
    document.getElementById("shareLink").value = link;
    updateHostLobby();
    show("hostSetup");
  });
  peer.on("connection", setupHostConn);
  peer.on("error", (e) => toast("Connection error: " + e.type));
}

function setupHostConn(conn) {
  connections[conn.peer] = conn;
  conn.on("open", () => {
    conn.on("data", (msg) => {
      if (msg.type === "needSecret") {
        const id = Object.keys(players).find((k) => players[k].peer === conn.peer);
        if (id) conn.send({ type: "secret", imposter: id === game.imposter, word: id === game.imposter ? null : game.word });
        return;
      }
      hostMessage(conn, msg);
    });
  });
  conn.on("close", () => {
    delete connections[conn.peer];
    for (const id in players) if (players[id].peer === conn.peer) delete players[id];
    broadcast({ type: "lobby", players: Object.values(players) });
    updateHostLobby();
  });
}

function hostMessage(conn, msg) {
  if (msg.type === "join") {
    const name = (msg.name || "Player").trim().slice(0, 24);
    if (Object.values(players).some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      conn.send({ type: "error", message: "That name is already taken." });
      return;
    }
    const id = "p" + Math.random().toString(36).slice(2, 9);
    players[id] = { id, name, peer: conn.peer };
    conn.send({ type: "joined", id, room: roomId });
    broadcast({ type: "lobby", players: Object.values(players).map((p) => ({ id: p.id, name: p.name, isHost: p.isHost })) });
    updateHostLobby();
  }
  if (msg.type === "vote") {
    if (!game.votes) game.votes = {};
    if (!game.votes[msg.from]) {
      game.votes[msg.from] = msg.target;
      const totalVotesNeeded = Object.keys(players).length;
      broadcast({ type: "voteProgress", count: Object.keys(game.votes).length, total: totalVotesNeeded });
      document.getElementById("voteProgress").textContent = `${Object.keys(game.votes).length} / ${totalVotesNeeded} votes received`;
      if (Object.keys(game.votes).length === totalVotesNeeded) finishVote();
    }
  }
  if (msg.type === "guess" && game.imposter === msg.from) {
    if (game.guessHandled) return;
    game.guessHandled = true;

    const correct = String(msg.guess).trim().toLowerCase() === game.word.toLowerCase();
    if (correct) game.scores[msg.from] = (game.scores[msg.from] || 0) + 6;
    broadcast({ type: "guessResult", correct, guesser: players[msg.from]?.name });
    setTimeout(() => sendResults(), 500);
  }
}

function broadcast(msg) {
  Object.values(connections).forEach((c) => { try { c.send(msg); } catch (e) {} });
}

function updateHostLobby() {
  document.getElementById("hostCount").textContent = Object.keys(players).length;
  document.getElementById("hostPlayers").innerHTML = Object.values(players).map((p) => `<div class="player">👤 ${clean(p.name)}${p.isHost ? " 👑" : ""}</div>`).join("");
  document.getElementById("startBtn").disabled = Object.keys(players).length < 3;
}

function copyLink() {
  navigator.clipboard.writeText(document.getElementById("shareLink").value);
  toast("Game link copied!");
}

function hostStart() {
  if (Object.keys(players).length < 3) return;
  game = {
    round: 1, total: +document.getElementById("rounds").value, category: document.getElementById("category").value,
    scores: {}, votes: {}, word: "", imposter: "", phase: "reveal"
  };
  Object.keys(players).forEach((id) => (game.scores[id] = 0));
  startHostRound();
}

function startHostRound() {
  const pool = WORDS[game.category];
  game.word = pool[Math.floor(Math.random() * pool.length)];
  const ids = Object.keys(players);
  game.imposter = ids[Math.floor(Math.random() * ids.length)];
  game.votes = {}; game.phase = "reveal"; game.guessHandled = false;

  Object.entries(players).forEach(([id, p]) => {
    if (!p.isHost && connections[p.peer]) {
      connections[p.peer].send({ type: "secret", imposter: id === game.imposter, word: id === game.imposter ? null : game.word });
    }
  });
  mySecret = { imposter: game.imposter === "host", word: game.imposter === "host" ? null : game.word };
  lastPlayers = players;

  broadcast({ type: "round", round: game.round, total: game.total, phase: "reveal" });
  renderHostReveal();
}

function renderHostReveal() {
  show("reveal");
  document.getElementById("roundLabel").textContent = `Round ${game.round} of ${game.total}`;
  document.getElementById("revealTitle").textContent = "Your secret is ready";
  document.getElementById("revealInstruction").textContent = "Tap to privately reveal your role.";
  document.getElementById("revealBtn").textContent = "👀 Reveal My Secret";
  document.getElementById("revealBtn").onclick = revealSecret;
  document.getElementById("hostClueBtn").classList.remove("hidden");
  document.getElementById("secretBox").classList.add("hidden");
}

function hostStartClues() {
  game.phase = "clues";
  broadcast({ type: "phase", phase: "clues", round: game.round });
  renderClues();
}

function renderClues() {
  show("clues");
  document.getElementById("clueRound").textContent = `Round ${game.round}`;
  document.getElementById("clueStatus").textContent = host
    ? "Clues in progress. When done, open voting."
    : "Everyone gives one clue out loud!";

  document.getElementById("hostTimerBtn").classList.toggle("hidden", !host);
  document.getElementById("voteOpenBtn").classList.toggle("hidden", !host);
}

function hostOpenVote() {
  game.phase = "vote"; game.votes = {}; myVoteDone = false;
  broadcast({ type: "phase", phase: "vote", players: Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { name: p.name }])) });
  renderVoteHost();
}

function renderVoteHost() {
  show("vote");
  document.getElementById("voteInstruction").textContent = "Cast your vote below:";
  document.getElementById("voteProgress").textContent = `0 / ${Object.keys(players).length} votes received`;
  const opts = Object.entries(players).filter(([id]) => id !== "host").map(([id, p]) => `<button onclick="castHostVote('${id}')">🗳️ ${clean(p.name)}</button>`).join("");
  document.getElementById("voteChoices").innerHTML = opts;
}

function castHostVote(target) {
  if (myVoteDone) return;
  myVoteDone = true;
  game.votes["host"] = target;
  document.getElementById("voteChoices").innerHTML = "<div class='status'>✅ Vote submitted.</div>";
  const totalVotesNeeded = Object.keys(players).length;
  broadcast({ type: "voteProgress", count: Object.keys(game.votes).length, total: totalVotesNeeded });
  document.getElementById("voteProgress").textContent = `${Object.keys(game.votes).length} / ${totalVotesNeeded} votes received`;
  if (Object.keys(game.votes).length === totalVotesNeeded) finishVote();
}

function finishVote() {
  const counts = {};
  Object.values(game.votes).forEach((x) => (counts[x] = (counts[x] || 0) + 1));
  const max = Math.max(...Object.values(counts));
  const top = Object.keys(counts).filter((x) => counts[x] === max);
  game.caught = top.length === 1 && top[0] === game.imposter;
  
  if (game.caught) {
    Object.keys(players).forEach((id) => { if (id !== game.imposter) game.scores[id] += 2; });
  } else {
    game.scores[game.imposter] += 4;
  }
  game.phase = "result";
  sendResults();
}

function sendResults() {
  const payload = {
    type: "result", round: game.round, word: game.word, imposter: game.imposter,
    caught: game.caught, scores: game.scores,
    players: Object.fromEntries(Object.entries(players).map(([k, v]) => [k, v.name]))
  };
  broadcast(payload);
  renderResult(payload, true);
}

function renderResult(r, isHost = false) {
  show("result");
  
  myGuessDone = false; 
  const guessInput = document.getElementById("guessInput");
  if (guessInput) {
    guessInput.value = "";
    guessInput.disabled = false;
  }

  lastPlayers = Object.fromEntries(Object.entries(r.players).map(([id, name]) => [id, { name }]));
  document.getElementById("resultRound").textContent = `Round ${r.round}`;
  const impName = r.players[r.imposter];
  document.getElementById("resultTitle").textContent = r.caught ? "🎉 IMPOSTER CAUGHT!" : "😈 IMPOSTER ESCAPED!";
  document.getElementById("resultText").textContent = r.caught
    ? `${impName} was the Imposter! Everyone else gets 2 points.`
    : `The vote missed! ${impName} was the Imposter and gets 4 points.`;
  
  const isCaughtImposter = r.caught && myId === r.imposter;
  if (isCaughtImposter) {
    document.getElementById("resultWord").textContent = "Secret: ???";
  } else {
    document.getElementById("resultWord").textContent = `Secret: ${r.word}`;
  }

  document.getElementById("resultScores").innerHTML = Object.entries(r.scores)
    .sort((a, b) => b[1] - a[1])
    .map(([id, s]) => `<span class="pill">${clean(r.players[id])}: <b>${s}</b></span>`).join("");
  
  document.getElementById("guessArea").classList.toggle("hidden", !isCaughtImposter);
  document.getElementById("nextBtn").classList.toggle("hidden", !isHost);
}

function hostNextRound() {
  if (game.round >= game.total) { finishGame(); return; }
  game.round++;
  startHostRound();
}

function finishGame() {
  const names = Object.fromEntries(Object.entries(players).map(([k, v]) => [k, v.name]));
  broadcast({ type: "final", scores: game.scores, names });
  renderFinal(game.scores, names);
}

function renderFinal(scores, names) {
  show("final");
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  document.getElementById("winner").textContent = `🏆 ${clean(names[sorted[0][0]])} — ${sorted[0][1]} points`;
  document.getElementById("finalScores").innerHTML = sorted
    .map(([id, s], i) => `<div class="player" style="margin:8px">#${i + 1} <b>${clean(names[id])}</b><br>${s} points</div>`).join("");
}

function joinRoom() {
  const name = document.getElementById("joinName").value.trim();
  if (!name) { alert("Enter your name."); return; }

  const params = new URLSearchParams(location.search);
  let code = params.get("room");
  let hostPeer = params.get("host") || (document.getElementById("joinHostId") ? document.getElementById("joinHostId").value.trim() : "");

  if (!hostPeer) { alert("Invalid host peer ID. Use a full game link."); return; }

  me = name; roomId = code || "JOINED"; host = false;
  show("lobby");
  document.getElementById("lobbyCode").textContent = roomId;
  
  // Applied peerConfig here for client joining
  peer = new Peer(peerConfig);
  
  peer.on("open", () => {
    hostConn = peer.connect(hostPeer, { reliable: true });
    hostConn.on("open", () => hostConn.send({ type: "join", name }));
    hostConn.on("data", clientMessage);
    hostConn.on("close", () => toast("Host disconnected."));
  });
  peer.on("error", (e) => toast("Connection error: " + e.type));
}

function clientMessage(msg) {
  if (msg.type === "error") { alert(msg.message); return; }
  if (msg.type === "joined") { myId = msg.id; return; }
  if (msg.type === "lobby") {
    document.getElementById("lobbyPlayers").innerHTML = msg.players
      .map((p) => `<div class="player">👤 ${clean(p.name)}${p.isHost ? " 👑" : ""}</div>`).join("");
    return;
  }
  if (msg.type === "round") {
    game.round = msg.round; game.total = msg.total; game.phase = msg.phase; mySecret = null;
    show("reveal");
    document.getElementById("roundLabel").textContent = `Round ${msg.round} of ${msg.total}`;
    document.getElementById("revealTitle").textContent = "Your secret is ready";
    document.getElementById("revealInstruction").textContent = "Tap the button to see your private role.";
    document.getElementById("revealBtn").textContent = "👀 Reveal My Secret";
    document.getElementById("revealBtn").onclick = revealSecret;
    document.getElementById("hostClueBtn").classList.add("hidden");
    document.getElementById("secretBox").classList.add("hidden");
    return;
  }
  if (msg.type === "secret") {
    mySecret = msg;
    if (!document.getElementById("secretBox").classList.contains("hidden")) displaySecret();
    return;
  }
  if (msg.type === "phase") {
    game.phase = msg.phase;
    if (msg.players) lastPlayers = msg.players;
    if (msg.phase === "clues") renderClues();
    if (msg.phase === "vote") renderVoteClient();
    return;
  }
  if (msg.type === "startTimer") {
    runTimer(msg.seconds);
    return;
  }
  if (msg.type === "voteProgress") {
    document.getElementById("voteProgress").textContent = `${msg.count} / ${msg.total} votes received`;
    return;
  }
  if (msg.type === "result") { renderResult(msg, false); return; }
  if (msg.type === "guessResult") {
    document.getElementById("resultText").innerHTML += msg.correct
      ? `<br><br>😈 ${clean(msg.guesser)} guessed correctly and gets 6 bonus points!`
      : `<br><br>❌ ${clean(msg.guesser)} guessed incorrectly.`;
    document.getElementById("guessArea").classList.add("hidden");
    return;
  }
  if (msg.type === "final") renderFinal(msg.scores, msg.names);
}

function revealSecret() {
  document.getElementById("secretBox").classList.remove("hidden");
  if (mySecret) { displaySecret(); return; }
  if (hostConn) hostConn.send({ type: "needSecret", from: myId });
}

function displaySecret() {
  if (!mySecret) return;
  document.getElementById("roleText").textContent = mySecret.imposter ? "😈 You are the IMPOSTER!" : "🕵️ You are a Detective";
  document.getElementById("secretWord").textContent = mySecret.imposter ? "???" : mySecret.word;
  document.getElementById("secretHint").textContent = mySecret.imposter
    ? "Blend in and try to figure out the secret word from clues."
    : "Give a subtle clue without revealing the word directly!";
}

function renderVoteClient() {
  show("vote");
  myVoteDone = false;
  document.getElementById("voteInstruction").textContent = "Choose one player. Your vote is private.";
  const opts = Object.entries(lastPlayers)
    .filter(([id]) => id !== myId)
    .map(([id, p]) => `<button onclick="castClientVote('${id}')">🗳️ ${clean(p.name || p)}</button>`).join("");
  document.getElementById("voteChoices").innerHTML = opts;
  document.getElementById("voteProgress").textContent = "Waiting for votes...";
}

function castClientVote(target) {
  if (myVoteDone) return;
  myVoteDone = true;
  hostConn.send({ type: "vote", from: myId, target });
  document.getElementById("voteChoices").innerHTML = "<div class='status'>✅ Vote submitted. Waiting for everyone...</div>";
}

function sendGuess() {
  if (myGuessDone) return;
  const g = document.getElementById("guessInput").value.trim();
  if (g) {
    myGuessDone = true;
    document.getElementById("guessInput").disabled = true;
    if (host) {
      if (game.guessHandled) return;
      game.guessHandled = true;
      const correct = g.toLowerCase() === game.word.toLowerCase();
      if (correct) game.scores["host"] = (game.scores["host"] || 0) + 6;
      broadcast({ type: "guessResult", correct, guesser: "Host" });
      setTimeout(() => sendResults(), 500);
    } else {
      hostConn.send({ type: "guess", from: myId, guess: g });
    }
  }
}

function startTimer() {
  runTimer(60);
  if (host) {
    broadcast({ type: "startTimer", seconds: 60 });
  }
}

function runTimer(seconds) {
  let t = seconds;
  document.getElementById("timer").textContent = t;
  stopTimer();
  timerInt = setInterval(() => {
    t--;
    document.getElementById("timer").textContent = t;
    if (t <= 0) stopTimer();
  }, 1000);
}

window.addEventListener("load", () => {
  const q = new URLSearchParams(location.search);
  if (q.get("room") && q.get("host")) show("join");
});
