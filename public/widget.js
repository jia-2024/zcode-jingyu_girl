// 鲸鱼娘控制台脚本：语境状态轮询 + 形态/换装 + GLM 额度主显示 + 记录
(() => {
  if (window.__zcodeWhaleConsole) return
  window.__zcodeWhaleConsole = true

  const $ = (id) => document.getElementById(id)
  let forms = {}, outfits = [], curState = null

  // ---- 语境状态轮询 ----
  async function pollContext() {
    try {
      const data = await (await fetch('/api/context-state.json')).json()
      const st = await (await fetch('/api/state.json')).json()
      if (data.ok) data._accs = (st.state || {}).accessories || []
      const cs = data
      if (!cs.ok) return
      curState = cs
      // 形象
      if (cs.imageUrl) { $('charImg').src = cs.imageUrl + '?t=' + Math.floor(Date.now() / 60000) }
      $('charName').textContent = cs.character.name
      $('charMeta').textContent = `${cs.character.formName} · ${cs.character.outfitName}`
      const stateNames = { idle: '待机', happy: '开心', eating: '干饭', working: '工作中', thinking: '思考中', sleeping: '睡觉中', sad: '难过', error: '出错了', alert: '讨债中', proud: '傲娇', confused: '困惑', angry: '生气', glm: 'GLM 梗' }
      $('stateInfo').textContent = `状态：${stateNames[cs.state] || cs.state}${cs.memeUrl ? ' · 表情包时间' : ''}`
      // 气泡：表情包优先
      const bubble = $('bubble')
      if (cs.memeUrl) {
        bubble.innerHTML = ''
        const img = document.createElement('img')
        img.src = cs.memeUrl
        bubble.appendChild(img)
      } else {
        bubble.textContent = cs.line
      }
      // 额度（主显示）
      if (cs.quota && cs.quota.ok) {
        $('glmLevel').textContent = cs.quota.level ? `· ${cs.quota.level} 档` : ''
        $('quotaWins').innerHTML = cs.quota.windows.map((w) => {
          const remain = 100 - w.usedPct
          const reset = w.resetsAt ? fmtCountdown(w.resetsAt) : ''
          return `<div class="quota-win">
            <div class="qrow"><b>${w.label}窗口</b><span>剩 <b>${remain}%</b>（已用 ${w.used}/${w.total}）</span></div>
            <div class="bar ${w.usedPct >= 80 ? 'hot' : ''}"><i style="width:${w.usedPct}%"></i></div>
            <div class="qrow"><span class="muted">${w.usedPct}% 已用</span><span class="muted">重置：${reset}</span></div>
          </div>`
        }).join('')
        $('quotaUpd').textContent = '更新于 ' + new Date(cs.quota.updatedAt).toLocaleTimeString('zh-CN')
      } else {
        $('quotaWins').innerHTML = `<div class="muted">${cs.quota?.error || '额度不可用'}</div>`
      }
      // DeepSeek 次显示
      if (cs.balance) {
        $('dsBalance').textContent = '¥ ' + Number(cs.balance.totalBalance).toFixed(2)
        $('dsMeta').textContent = (cs.balance.stale ? '（缓存值）' : '实时') + ' · 鲸鱼记账中'
      } else {
        $('dsBalance').textContent = '—'
      }
      $('todayUse').textContent = '¥' + Number(cs.todayUsage).toFixed(2)
      $('peakInfo').textContent = cs.isPeak ? '⛰️ 高峰时段（9-12 / 14-18）计价 ×2' : '🌊 空闲时段（周末全天谷价）'
      if (cs.weather) {
        if (cs.weather.ok) {
          $('weatherCity').textContent = '· ' + cs.weather.city
          $('weatherMain').textContent = cs.weather.text + ' ' + cs.weather.temp + '°C'
          $('weatherSub').textContent = `今日 ${cs.weather.tmin}~${cs.weather.tmax}°C · 风速 ${cs.weather.windspeed}km/h${cs.weather.reminder ? ' · ' + cs.weather.reminder : ''}`
        } else { $('weatherMain').textContent = '—'; $('weatherSub').textContent = cs.weather.error || '' }
      }
    } catch {}
  }
  function fmtCountdown(ts) {
    let s = Math.max(0, Math.floor((ts - Date.now()) / 1000))
    const d = Math.floor(s / 86400); s %= 86400
    const h = Math.floor(s / 3600); s %= 3600
    const m = Math.floor(s / 60)
    if (d > 0) return `${d}天${h}小时后`
    if (h > 0) return `${h}小时${m}分后`
    return `${m}分${s % 60}秒后`
  }

  // ---- 形态/换装/饰品 ----
  let accMap = {}
  async function loadCharacters() {
    try {
      const d = await (await fetch('/api/characters.json')).json()
      if (!d.ok) return
      const char = d.characters[0]
      forms = char.forms || {}
      outfits = char.outfits || []
      try {
        const bmd = await (await fetch('/api/body-model.json')).json()
        accMap = bmd.ok ? Object.fromEntries(bmd.bodyModel.accessories.map((a) => [a.id, a.name])) : {}
      } catch {}
      const st = await (await fetch('/api/state.json')).json()
      const cur = st.state || {}
      $('formRow').innerHTML = Object.entries(forms).map(([id, f]) =>
        `<span class="chip ${cur.form === id ? 'on' : ''}" onclick="setForm('${id}')">${f.name} ${f.heads}头身</span>`).join('')
      $('outfitRow').innerHTML = outfits.map((o) =>
        `<span class="chip warn ${cur.outfit === o.id ? 'on' : ''}" onclick="setOutfit('${o.id}')">👗 ${o.name}</span>`).join('')
      const accs = cur.accessories || []
      $('accRow').innerHTML = Object.entries(accMap).map(([id, name]) =>
        `<span class="chip ${accs.includes(id) ? 'on' : ''}" onclick="toggleAcc('${id}')">🎀 ${name}</span>`).join('') +
        `<span class="chip" onclick="putState({accessories:[]})">摘掉全部</span>`
      $('autoChip').classList.toggle('on', !cur.manual)
      $('memeChip').classList.toggle('on', cur.memeBubbles !== false)
      $('petChip').textContent = '🐋 鲸鱼娘：' + (cur.petOn !== false ? '开' : '关')
      const s = (await (await fetch('/api/settings.json')).json()).settings
      $('balanceWarn').value = s.balanceWarn
      $('dailyBudget').value = s.dailyBudget
    } catch {}
  }
  async function putState(patch) {
    await fetch('/api/state.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
    loadCharacters(); pollContext()
  }
  window.putState = putState
  window.setForm = (f) => putState({ form: f })
  window.setOutfit = (o) => putState({ outfit: o })
  window.setManual = (manual, s) => putState({ manual, manualState: s || null })
  window.toggleMeme = () => putState({ memeBubbles: $('memeChip').classList.contains('on') ? false : true })
  window.togglePet = () => putState({ petOn: $('petChip').textContent.includes('开') ? false : true })
  window.toggleAcc = (id) => {
    const st = curState ? ((curState._accs) || []) : []
    // 以最新 settings 为准再取
    fetch('/api/state.json').then((r) => r.json()).then((j) => {
      const cur = j.state.accessories || []
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
      putState({ accessories: next })
    })
  }

  window.setCity = async () => {
    const v = $('weatherCityInput').value.trim()
    if (!v) return
    await fetch('/api/state.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weatherCity: v }) })
    pollContext()
  }

  // ---- 金币商店 / 性格 / 导入 ----
  async function loadShop() {
    try {
      const d = await (await fetch('/api/shop.json')).json()
      if (!d.ok) return
      $('coinBalance').textContent = '🪙 ' + d.coins + '（累计已铸 ' + d.coinsEarnedTotal + '）'
      const owned = new Set(d.owned)
      $('shopGrid').innerHTML = d.items.map((i) => {
        const has = owned.has(i.id)
        return `<span class="chip ${has ? 'on' : ''}" onclick="buyItem('${i.id}')">${i.kind === 'outfit' ? '👗' : '🎀'} ${i.name} · ${i.price}🪙${has ? ' 已拥有' : ''}</span>`
      }).join('')
    } catch {}
  }
  window.buyItem = async (id) => {
    const r = await (await fetch('/api/shop/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: id }) })).json()
    $('coinBalance').textContent = r.ok ? '买到啦 ✓' : (r.error || '失败')
    loadShop(); loadCharacters()
    setTimeout(() => loadShop(), 1200)
  }
  async function loadPersonality() {
    try {
      const d = await (await fetch('/api/personality.json')).json()
      if (!d.ok) return
      $('persName').textContent = d.current.emoji + ' ' + d.current.name + '（首启随机，永久固定）'
      $('persTemper').textContent = d.current.temper + '。其他性格：' + d.all.filter((x) => x.id !== d.current.id).map((x) => x.emoji + x.name).join('、')
    } catch {}
  }
  window.doImport = async (kind) => {
    const path = $('importPath').value.trim()
    if (!path) { $('importMsg').textContent = '先填本地文件夹路径'; return }
    $('importMsg').textContent = '导入中…'
    try {
      const r = await (await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, path, name: path.split(/[\/]/).pop() }) })).json()
      $('importMsg').textContent = r.ok ? '导入成功 ✓ 装扮列表已更新' : '失败：' + (r.error || '')
      loadCharacters()
    } catch (e) { $('importMsg').textContent = '失败：' + String(e).slice(0, 60) }
  }

  // ---- 表情包工坊 ----
  async function loadPresets() {
    try {
      const d = await (await fetch('/api/meme/presets.json')).json()
      if (!d.ok) return
      $('presetRow').innerHTML = d.presets.map((p) =>
        `<span class="chip" onclick="genPreset('${p.id}')">${p.name}</span>`).join('')
      $('genGallery').innerHTML = (d.generated || []).slice(0, 8).map((g) =>
        `<img src="${g.url}" style="width:92px;border-radius:8px;border:1px solid #e3e8f5" title="${g.file}">`).join('')
    } catch {}
  }
  async function genMeme(payload) {
    $('genMsg').textContent = '生成中…（10~30 秒）'
    try {
      const r = await (await fetch('/api/meme/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload) })).json()
      $('genMsg').textContent = r.ok ? '完成 ✓ 已存入表情包库' : '失败：' + (r.error || '').slice(0, 60)
      if (r.ok) loadPresets()
    } catch (e) { $('genMsg').textContent = '失败：' + String(e).slice(0, 60) }
  }
  window.genPreset = (id) => genMeme({ preset: id })
  window.genMeme = () => {
    const v = $('memePrompt').value.trim()
    if (v) genMeme({ prompt: v })
  }

  window.saveSettings = async () => {
    const r = await fetch('/api/settings.json', { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balanceWarn: Number($('balanceWarn').value) || 0, dailyBudget: Number($('dailyBudget').value) || 0 }) })
    $('saveMsg').textContent = r.ok ? '已保存 ✓' : '保存失败'
    setTimeout(() => ($('saveMsg').textContent = ''), 2000)
  }

  // ---- 记录 ----
  async function pollRecords() {
    try {
      const d = await (await fetch('/api/records.json?days=1')).json()
      if (!d.ok) return
      const rows = (d.todayDetail || []).slice(0, 12)
      $('recordsBody').innerHTML = rows.length
        ? rows.map((e) => `<tr><td>${e.time}</td><td>${e.model}</td><td class="num">${e.in || 0} / ${e.out || 0}</td><td class="num">¥${Number(e.cost).toFixed(4)}</td></tr>`).join('')
        : '<tr><td colspan="4" class="muted">今天还没有对话记录</td></tr>'
    } catch {}
  }

  // ---- 点击 Q 弹 ----
  $('charImg').addEventListener('pointerdown', () => $('charImg').classList.add('press'))
  addEventListener('pointerup', () => $('charImg').classList.remove('press'))

  loadCharacters()
  loadPresets()
  loadShop()
  loadPersonality()
  pollContext(); pollRecords()
  setInterval(pollContext, 8000)
  setInterval(pollRecords, 30000)
  setInterval(loadPresets, 60000)
  setInterval(loadShop, 60000)
  setInterval(loadCharacters, 60000)
})()
