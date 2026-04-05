// ═══════════════════════════════════════════════════════
// Kỷ Niệm Lớp — Cloudflare Worker (D1 + R2 + GitHub)
// Bindings: DB (D1), BUCKET (R2), ASSETS (Static Assets)
// ═══════════════════════════════════════════════════════

const OWNER = { username: 'truehieu', password: 'hieu2011@', displayName: 'True Hieu', role: 'owner' };
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// ─── Helpers ───

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password + '_ky_niem_lop_salt_2024');
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getSession(request, db) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const session = await db.prepare('SELECT s.username, u.role, u.display_name FROM sessions s JOIN users u ON s.username = u.username WHERE s.token = ?').bind(token).first();
  return session;
}

function requireAuth(user) {
  if (!user) return err('Chưa đăng nhập', 401);
  return null;
}

function requireAdmin(user) {
  if (!user) return err('Chưa đăng nhập', 401);
  if (user.role !== 'owner' && user.role !== 'admin') return err('Không có quyền', 403);
  return null;
}

function requireOwner(user) {
  if (!user) return err('Chưa đăng nhập', 401);
  if (user.role !== 'owner') return err('Chỉ Owner mới có quyền', 403);
  return null;
}

// ─── Ensure Owner Exists ───

async function ensureOwner(db) {
  const exists = await db.prepare('SELECT username FROM users WHERE username = ?').bind(OWNER.username).first();
  if (!exists) {
    const hash = await hashPassword(OWNER.password);
    await db.prepare('INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(OWNER.username, hash, OWNER.displayName, OWNER.role, Date.now())
      .run();
  }
}

// ─── GitHub Storage ───

async function uploadToGitHub(db, fileBuffer, filename) {
  const tokenRow = await db.prepare("SELECT value FROM config WHERE key = 'github_token'").first();
  const repoRow = await db.prepare("SELECT value FROM config WHERE key = 'github_repo'").first();
  if (!tokenRow || !repoRow) return null;

  const token = tokenRow.value;
  const repo = repoRow.value;
  const path = `images/${filename}`;
  const content = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'KyNiemLop-Worker',
    },
    body: JSON.stringify({
      message: `Upload ${filename}`,
      content: content,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.content?.download_url || null;
}

// ─── Route Handler ───

async function handleAPI(request, env, url) {
  const { DB, BUCKET } = env;
  const method = request.method;
  const path = url.pathname.replace('/api', '');

  // Ensure owner on every request (lightweight check)
  await ensureOwner(DB);

  // Get current user
  const user = await getSession(request, DB);

  // ── AUTH ──

  if (path === '/auth/login' && method === 'POST') {
    const body = await request.json();
    const { username, password } = body;
    if (!username || !password) return err('Thiếu thông tin');

    const u = await DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
    if (!u) return err('Tài khoản không tồn tại');

    const hash = await hashPassword(password);
    if (u.password_hash !== hash) return err('Sai mật khẩu');

    const token = uid() + uid();
    await DB.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)').bind(token, username, Date.now()).run();

    return json({ token, user: { username: u.username, displayName: u.display_name, role: u.role } });
  }

  if (path === '/auth/register' && method === 'POST') {
    const body = await request.json();
    const { username, password, displayName } = body;
    if (!username || !password) return err('Thiếu thông tin');
    if (username.length < 3) return err('Username tối thiểu 3 ký tự');
    if (password.length < 4) return err('Mật khẩu tối thiểu 4 ký tự');

    const exists = await DB.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
    if (exists) return err('Username đã tồn tại');

    const hash = await hashPassword(password);
    await DB.prepare('INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(username, hash, displayName || username, 'member', Date.now()).run();

    const token = uid() + uid();
    await DB.prepare('INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)').bind(token, username, Date.now()).run();

    return json({ token, user: { username, displayName: displayName || username, role: 'member' } });
  }

  if (path === '/auth/me' && method === 'GET') {
    const chk = requireAuth(user);
    if (chk) return chk;
    return json({ user: { username: user.username, displayName: user.display_name, role: user.role } });
  }

  if (path === '/auth/logout' && method === 'POST') {
    const auth = request.headers.get('Authorization');
    if (auth && auth.startsWith('Bearer ')) {
      await DB.prepare('DELETE FROM sessions WHERE token = ?').bind(auth.slice(7)).run();
    }
    return json({ ok: true });
  }

  // ── USERS (Admin) ──

  if (path === '/users' && method === 'GET') {
    const chk = requireAdmin(user);
    if (chk) return chk;
    const rows = await DB.prepare('SELECT username, display_name, role, created_at FROM users ORDER BY created_at').all();
    return json(rows.results);
  }

  if (path === '/users' && method === 'POST') {
    const chk = requireAdmin(user);
    if (chk) return chk;
    const body = await request.json();
    const { username, password, displayName } = body;
    if (!username || !password) return err('Thiếu thông tin');

    const exists = await DB.prepare('SELECT username FROM users WHERE username = ?').bind(username).first();
    if (exists) return err('Username đã tồn tại');

    const hash = await hashPassword(password);
    await DB.prepare('INSERT INTO users (username, password_hash, display_name, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(username, hash, displayName || username, 'member', Date.now()).run();

    return json({ ok: true });
  }

  if (path.startsWith('/users/') && method === 'DELETE') {
    const chk = requireAdmin(user);
    if (chk) return chk;
    const target = decodeURIComponent(path.split('/users/')[1]);
    if (target === OWNER.username) return err('Không thể xoá Owner');

    // Admin can only delete members
    if (user.role === 'admin') {
      const t = await DB.prepare('SELECT role FROM users WHERE username = ?').bind(target).first();
      if (t && t.role !== 'member') return err('Admin chỉ có thể xoá Member');
    }

    await DB.prepare('DELETE FROM sessions WHERE username = ?').bind(target).run();
    await DB.prepare('DELETE FROM users WHERE username = ?').bind(target).run();
    return json({ ok: true });
  }

  if (path.startsWith('/users/') && path.endsWith('/role') && method === 'PATCH') {
    const chk = requireOwner(user);
    if (chk) return chk;
    const target = decodeURIComponent(path.replace('/users/', '').replace('/role', ''));
    if (target === OWNER.username) return err('Không thể đổi role Owner');

    const t = await DB.prepare('SELECT role FROM users WHERE username = ?').bind(target).first();
    if (!t) return err('User không tồn tại');

    const newRole = t.role === 'admin' ? 'member' : 'admin';
    await DB.prepare('UPDATE users SET role = ? WHERE username = ?').bind(newRole, target).run();
    return json({ ok: true, newRole });
  }

  // ── MEMORIES ──

  if (path === '/memories' && method === 'GET') {
    const chk = requireAuth(user);
    if (chk) return chk;
    const rows = await DB.prepare('SELECT id, image_key, storage_type, uploader, created_at FROM memories ORDER BY created_at DESC').all();
    return json(rows.results);
  }

  if (path === '/memories' && method === 'POST') {
    const chk = requireAuth(user);
    if (chk) return chk;

    const formData = await request.formData();
    const files = formData.getAll('images');
    if (!files.length) return err('Không có ảnh');

    const results = [];
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) continue;

      const id = uid();
      const ext = file.name?.split('.').pop() || 'jpg';
      const key = `memories/${id}.${ext}`;

      // Upload to R2
      const buffer = await file.arrayBuffer();
      await BUCKET.put(key, buffer, {
        httpMetadata: { contentType: file.type || 'image/jpeg' },
      });

      // Also try GitHub if configured
      let githubUrl = null;
      try {
        githubUrl = await uploadToGitHub(DB, buffer, `${id}.${ext}`);
      } catch (e) { /* GitHub optional */ }

      await DB.prepare('INSERT INTO memories (id, image_key, storage_type, uploader, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, key, githubUrl ? 'both' : 'r2', user.username, Date.now()).run();

      // If GitHub URL exists, also store it
      if (githubUrl) {
        await DB.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)").bind(`github_url_${id}`, githubUrl).run();
      }

      results.push({ id, key });
    }

    return json({ ok: true, uploaded: results.length });
  }

  if (path.startsWith('/memories/') && method === 'DELETE') {
    const chk = requireAuth(user);
    if (chk) return chk;
    const id = path.split('/memories/')[1];

    const mem = await DB.prepare('SELECT * FROM memories WHERE id = ?').bind(id).first();
    if (!mem) return err('Không tìm thấy');

    const isAdmin = user.role === 'owner' || user.role === 'admin';
    if (!isAdmin && mem.uploader !== user.username) return err('Không có quyền');

    // Delete from R2
    try { await BUCKET.delete(mem.image_key); } catch (e) {}

    // Delete related data
    await DB.prepare('DELETE FROM comments WHERE memory_id = ?').bind(id).run();
    await DB.prepare('DELETE FROM reactions WHERE memory_id = ?').bind(id).run();
    await DB.prepare('DELETE FROM memories WHERE id = ?').bind(id).run();

    return json({ ok: true });
  }

  // ── IMAGES (serve from R2) ──

  if (path.startsWith('/images/') && method === 'GET') {
    const key = decodeURIComponent(path.replace('/images/', ''));
    const object = await BUCKET.get(key);
    if (!object) return new Response('Not found', { status: 404 });

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
        ...CORS_HEADERS,
      },
    });
  }

  // ── PROFILES ──

  if (path === '/profiles' && method === 'GET') {
    const chk = requireAuth(user);
    if (chk) return chk;
    const rows = await DB.prepare('SELECT * FROM profiles ORDER BY created_at').all();
    return json(rows.results);
  }

  if (path === '/profiles' && method === 'POST') {
    const chk = requireAdmin(user);
    if (chk) return chk;

    const formData = await request.formData();
    const name = formData.get('name');
    const nickname = formData.get('nickname') || '';
    const photo = formData.get('photo');

    if (!name) return err('Thiếu tên');

    const id = uid();
    let photoKey = null;

    if (photo && photo.size > 0) {
      const ext = photo.name?.split('.').pop() || 'jpg';
      photoKey = `profiles/${id}.${ext}`;
      await BUCKET.put(photoKey, await photo.arrayBuffer(), {
        httpMetadata: { contentType: photo.type || 'image/jpeg' },
      });
    }

    await DB.prepare('INSERT INTO profiles (id, name, nickname, photo_key, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, name, nickname, photoKey, user.username, Date.now()).run();

    return json({ ok: true, id });
  }

  if (path.startsWith('/profiles/') && method === 'DELETE') {
    const chk = requireAdmin(user);
    if (chk) return chk;
    const id = path.split('/profiles/')[1];

    const profile = await DB.prepare('SELECT photo_key FROM profiles WHERE id = ?').bind(id).first();
    if (profile && profile.photo_key) {
      try { await BUCKET.delete(profile.photo_key); } catch (e) {}
    }

    await DB.prepare('DELETE FROM profiles WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  // ── COMMENTS ──

  if (path === '/comments' && method === 'GET') {
    const chk = requireAuth(user);
    if (chk) return chk;
    const memoryId = url.searchParams.get('memory_id');
    let rows;
    if (memoryId) {
      rows = await DB.prepare('SELECT * FROM comments WHERE memory_id = ? ORDER BY created_at').bind(memoryId).all();
    } else {
      rows = await DB.prepare('SELECT * FROM comments ORDER BY created_at DESC').all();
    }
    return json(rows.results);
  }

  if (path === '/comments' && method === 'POST') {
    const chk = requireAuth(user);
    if (chk) return chk;
    const body = await request.json();
    const { memoryId, text } = body;
    if (!memoryId || !text) return err('Thiếu thông tin');

    const id = uid();
    await DB.prepare('INSERT INTO comments (id, memory_id, username, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, memoryId, user.username, text, Date.now()).run();

    return json({ ok: true, id, username: user.username, created_at: Date.now() });
  }

  if (path.startsWith('/comments/') && method === 'DELETE') {
    const chk = requireAdmin(user);
    if (chk) return chk;
    const id = path.split('/comments/')[1];
    await DB.prepare('DELETE FROM comments WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  // ── REACTIONS ──

  if (path === '/reactions' && method === 'GET') {
    const chk = requireAuth(user);
    if (chk) return chk;
    const memoryId = url.searchParams.get('memory_id');
    let rows;
    if (memoryId) {
      rows = await DB.prepare('SELECT * FROM reactions WHERE memory_id = ?').bind(memoryId).all();
    } else {
      rows = await DB.prepare('SELECT * FROM reactions').all();
    }
    return json(rows.results);
  }

  if (path === '/reactions' && method === 'POST') {
    const chk = requireAuth(user);
    if (chk) return chk;
    const body = await request.json();
    const { memoryId, emoji } = body;
    if (!memoryId || !emoji) return err('Thiếu thông tin');

    // Toggle: if exists, remove; if not, add
    const existing = await DB.prepare('SELECT id FROM reactions WHERE memory_id = ? AND username = ? AND emoji = ?')
      .bind(memoryId, user.username, emoji).first();

    if (existing) {
      await DB.prepare('DELETE FROM reactions WHERE id = ?').bind(existing.id).run();
      return json({ action: 'removed' });
    } else {
      const id = uid();
      await DB.prepare('INSERT INTO reactions (id, memory_id, username, emoji, created_at) VALUES (?, ?, ?, ?, ?)')
        .bind(id, memoryId, user.username, emoji, Date.now()).run();
      return json({ action: 'added', id });
    }
  }

  // ── CONFIG (Owner only) ──

  if (path === '/config' && method === 'GET') {
    const chk = requireOwner(user);
    if (chk) return chk;
    const rows = await DB.prepare("SELECT key, value FROM config WHERE key IN ('github_token', 'github_repo', 'r2_public_url')").all();
    const cfg = {};
    for (const r of rows.results) {
      cfg[r.key] = r.value;
    }
    return json(cfg);
  }

  if (path === '/config' && method === 'POST') {
    const chk = requireOwner(user);
    if (chk) return chk;
    const body = await request.json();

    for (const [key, value] of Object.entries(body)) {
      if (['github_token', 'github_repo', 'r2_public_url'].includes(key)) {
        await DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(key, value).run();
      }
    }
    return json({ ok: true });
  }

  // ── STATS (Admin) ──

  if (path === '/stats' && method === 'GET') {
    const chk = requireAdmin(user);
    if (chk) return chk;

    const userCount = await DB.prepare('SELECT COUNT(*) as c FROM users').first();
    const memCount = await DB.prepare('SELECT COUNT(*) as c FROM memories').first();
    const commentCount = await DB.prepare('SELECT COUNT(*) as c FROM comments').first();
    const profileCount = await DB.prepare('SELECT COUNT(*) as c FROM profiles').first();

    // Estimate R2 storage
    let storageBytes = 0;
    const mems = await DB.prepare('SELECT image_key FROM memories').all();
    for (const m of mems.results) {
      try {
        const head = await BUCKET.head(m.image_key);
        if (head) storageBytes += head.size;
      } catch (e) {}
    }
    const profs = await DB.prepare('SELECT photo_key FROM profiles WHERE photo_key IS NOT NULL').all();
    for (const p of profs.results) {
      try {
        const head = await BUCKET.head(p.photo_key);
        if (head) storageBytes += head.size;
      } catch (e) {}
    }

    return json({
      users: userCount.c,
      memories: memCount.c,
      comments: commentCount.c,
      profiles: profileCount.c,
      storageMB: (storageBytes / 1024 / 1024).toFixed(2),
    });
  }

  return err('Not found', 404);
}

// ─── Main Entry ───

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleAPI(request, env, url);
      } catch (e) {
        console.error('API Error:', e);
        return err('Lỗi server: ' + e.message, 500);
      }
    }

    // Serve static assets
    return env.ASSETS.fetch(request);
  },
};
