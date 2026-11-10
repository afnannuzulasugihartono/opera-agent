// @last-edited: 2026-11-10 UTC+7.
// @title: demo-kit - one engine behind every harness's install demo on the MCP install page.
// @state: one runtime per .mcpDemo, started when it scrolls into view and restarted on resize; it owns the cursor, the taskbar dock, and each step's timing, nothing else.
// @dependencies: none.

// WHY ONE ENGINE FOR NINE DEMOS: every harness follows the same rhythm - the taskbar icon is pressed, the window opens, the server is added, the harness says "connected".
// Only the window in between differs.
// WHY THE CURSOR IS COMPUTED, NOT TYPED: the stage is 1024 wide at any viewport and the window scales inside it, so every click point is measured fresh, the same way the download demo measures its buttons.

(() => {
  'use strict';

  const TYPE_PACE = 26;
  const HOT = { x: 4.6, y: 2.8 };
  const TOAST = 'opera-agent · 35 tools';

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  class Restart extends Error {}

  const trim = (text) => String(text).replace(/\s+/g, ' ').trim();

  const wire = (demo) => {
    const agent = demo.getAttribute('data-agent');
    const canvas = demo.querySelector('.ddCanvas');
    const cursor = demo.querySelector('.demoCursor');
    const ripple = demo.querySelector('.ddRipple');
    const lines = [...demo.querySelectorAll('.ddLine')];
    let generation = 0;
    let visible = false;
    let scale = 1;
    let pos = { x: 820, y: 470 };

    const guard = (token) => {
      if (token !== generation) throw new Restart();
    };

    const wait = (ms, token) => new Promise((resolve, reject) => {
      setTimeout(() => {
        if (token !== generation) reject(new Restart());
        else resolve();
      }, ms);
    });

    // the canvas sits inside a scroller with an invisible sizer, so the stage keeps its natural 1024px aspect inside the demo's own box instead of cropping edges or widening the page
    const scroller = document.createElement('div');
    scroller.className = 'ddScroll';
    canvas.replaceWith(scroller);
    const sizer = document.createElement('span');
    sizer.className = 'ddSizer';
    scroller.appendChild(sizer);
    scroller.appendChild(canvas);

    const canvasFit = () => {
      const k = demo.clientWidth / 1024;
      scale = k;
      const sizerW = 1024 * scale;
      const sizerH = 574 * scale;
      sizer.style.width = sizerW + 'px';
      sizer.style.height = sizerH + 'px';
      // canvas and sizer stay at the same origin; the pair recentres in the box when the demo is narrower than 1024px
      const dx = Math.max(0, (scroller.clientWidth - sizerW) / 2);
      const dy = Math.max(0, (scroller.clientHeight - sizerH) / 2);
      sizer.style.left = dx + 'px';
      sizer.style.top = dy + 'px';
      canvas.style.left = dx + 'px';
      canvas.style.top = dy + 'px';
      canvas.style.setProperty('--dd-k', String(scale));
    };

    const fit = () => { canvasFit(); };

    const measure = (el) => {
      const box = canvas.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return {
        x: (rect.left + rect.width / 2 - box.left) / scale,
        y: (rect.top + rect.height / 2 - box.top) / scale
      };
    };

    const paint = () => {
      cursor.style.transform = `translate3d(${pos.x - HOT.x}px, ${pos.y - HOT.y}px, 0)`;
    };

    const tween = (el, frames, options) => new Promise((resolve, reject) => {
      const animation = el.animate(frames, options);
      animation.finished.then(() => resolve(animation)).catch(() => reject(new Restart()));
    });

    const glide = async (el, token) => {
      guard(token);
      const to = measure(el);
      const distance = Math.hypot(to.x - pos.x, to.y - pos.y);
      if (distance < 1) {
        el.classList.add('is-hover');
        return;
      }
      el.classList.add('is-hover');
      const duration = Math.min(640, Math.max(230, distance * 0.6));
      const animation = await tween(cursor, [
        { transform: `translate3d(${pos.x - HOT.x}px, ${pos.y - HOT.y}px, 0)` },
        { transform: `translate3d(${to.x - HOT.x}px, ${to.y - HOT.y}px, 0)` }
      ], { duration, easing: 'cubic-bezier(.28,.72,.24,1)' });
      guard(token);
      pos = to;
      paint();
      animation.cancel();
    };

    const burst = (point) => {
      ripple.style.left = point.x + 'px';
      ripple.style.top = point.y + 'px';
      ripple.animate([
        { transform: 'translate(-50%, -50%) scale(.3)', opacity: 0.9 },
        { transform: 'translate(-50%, -50%) scale(1.55)', opacity: 0 }
      ], { duration: 470, easing: 'cubic-bezier(.2,.7,.3,1)' });
    };

    const press = async (el, token) => {
      await glide(el, token);
      await wait(90, token);
      burst(measure(el));
      el.classList.add('is-pressed');
      cursor.classList.add('is-pressed');
      await wait(115, token);
      el.classList.remove('is-pressed');
      cursor.classList.remove('is-pressed');
      el.classList.remove('is-hover');
      await wait(190, token);
    };

    const typeLine = async (el, token, pace) => {
      el.classList.add('is-on');
      const text = el.dataset.raw || trim(el.textContent);
      const target = el.querySelector('.ddLineText') ?? el;
      if (target !== el) target.textContent = '';
      else el.textContent = '';
      for (const char of text) {
        target.textContent += char;
        await wait(pace, token);
      }
    };

    const reveal = (el, token) => {
      if (!el) return;
      el.classList.add('is-on');
    };

    const replaceStatus = (text) => {
      const el = demo.querySelector('.ddStatusRight');
      if (el) el.textContent = text;
    };

    const reset = (token) => {
      demo.classList.remove('is-open', 'is-modal', 'is-row', 'is-done', 'is-appform', 'is-menu', 'is-settings', 'is-advanced', 'is-toolsmenu', 'is-toggled', 'is-authing', 'is-writing', 'is-sent', 'is-ready', 'is-usermsg', 'is-solid', 'is-wizard', 'is-review', 'is-added', 'is-connected', 'is-customize', 'is-connectors', 'is-addpopover', 'is-adddialog', 'is-mcps', 'is-slash', 'is-authed', 'is-browser', 'is-slash-terminal', 'is-slash-mcp');
      const ocWelcome = demo.querySelector('#ocWelcome');
      if (ocWelcome) ocWelcome.style.display = '';
      const ocTerminal = demo.querySelector('#ocTerminal');
      if (ocTerminal) { ocTerminal.style.display = 'none'; const row = demo.querySelector('#ocSplitRow'); if (row) row.classList.remove('has-terminal'); }
      const ocToolCard = demo.querySelector('#ocToolCard');
      if (ocToolCard) ocToolCard.style.display = 'none';
      const ocMetaRow = demo.querySelector('#ocMetaRow');
      if (ocMetaRow) ocMetaRow.style.display = 'none';
      const ocTermCmd = demo.querySelector('#ocTermCmd');
      if (ocTermCmd) ocTermCmd.textContent = '';
      const kiloMeta = demo.querySelector('#kiloMeta');
      if (kiloMeta) kiloMeta.textContent = 'Needs auth';
      const ocTermType = demo.querySelector('#ocTermType');
      if (ocTermType) ocTermType.textContent = '';
      const ocTermDim = demo.querySelector('#ocTermDim');
      if (ocTermDim) ocTermDim.classList.remove('is-on');
      const ocTermOk = demo.querySelector('#ocTermOk');
      if (ocTermOk) ocTermOk.classList.remove('is-on');
      const ocOutDim = demo.querySelector('#ocOutDim');
      if (ocOutDim) ocOutDim.classList.remove('is-on');
      const ocOutOk = demo.querySelector('#ocOutOk');
      if (ocOutOk) ocOutOk.classList.remove('is-on');
      const ocWorking = demo.querySelector('#ocWorkingRow');
      if (ocWorking) { ocWorking.classList.remove('is-done'); ocWorking.style.visibility = 'hidden'; }
      const deskTypedReset = demo.querySelector('#deskComposerTyped');
      if (deskTypedReset) deskTypedReset.textContent = '';
      const typedReset = demo.querySelector('#composerTyped');
      if (typedReset) typedReset.textContent = '';
      const ccTypedReset = demo.querySelector('#ccComposerTyped');
      if (ccTypedReset) ccTypedReset.textContent = '';
      const ocTypedReset = demo.querySelector('#ocComposerTyped');
      if (ocTypedReset) ocTypedReset.textContent = '';
      const ccNameText = demo.querySelector('#ccNameText');
      const ccNameField = demo.querySelector('#ccFieldName');
      if (ccNameText) ccNameText.textContent = '';
      if (ccNameField) ccNameField.classList.remove('is-on', 'has-value');
      const ccUrlText = demo.querySelector('#ccUrlText');
      const ccUrlField = demo.querySelector('#ccFieldUrl');
      if (ccUrlText) ccUrlText.textContent = '';
      if (ccUrlField) ccUrlField.classList.remove('is-on', 'has-value');
      const ccAdd = demo.querySelector('#ccDialogAddBtn');
      if (ccAdd) {
        ccAdd.disabled = true;
        ccAdd.classList.remove('is-enabled');
      }
      const ccToggle = demo.querySelector('#ccOaMenuToggle');
      if (ccToggle) {
        ccToggle.classList.remove('is-on');
        ccToggle.setAttribute('aria-checked', 'false');
      }
      for (const line of lines) {
        line.classList.remove('is-on');
        if (line.dataset.raw) {
          const target = line.querySelector('.ddLineText');
          if (target) target.textContent = '';
        }
      }
      const toggle = demo.querySelector('.ddRowToggle');
      if (toggle) toggle.classList.remove('on');
      const nameField = demo.querySelector('#fieldName');
      const nameText = demo.querySelector('#dpNameText');
      if (nameText) nameText.textContent = '';
      if (nameField) nameField.classList.remove('is-on', 'has-value');
      const urlField = demo.querySelector('#fieldUrl');
      const urlText = demo.querySelector('#dpUrlText');
      if (urlText) urlText.textContent = '';
      if (urlField) urlField.classList.remove('is-on', 'has-value');
      const box = demo.querySelector('#dpUnderstand');
      if (box) {
        box.classList.remove('is-checked');
        box.setAttribute('aria-checked', 'false');
      }
      const create = demo.querySelector('#newAppCreate');
      if (create) {
        create.disabled = true;
        create.classList.remove('is-enabled');
      }
      const devToggle = demo.querySelector('.devModeToggle');
      if (devToggle) {
        devToggle.classList.remove('is-on');
        devToggle.setAttribute('aria-checked', 'false');
      }
      const advCreate = demo.querySelector('#advCreate2');
      if (advCreate) {
        advCreate.disabled = true;
        advCreate.classList.remove('is-enabled');
      }
      const oaToggle = demo.querySelector('#oaMenuToggle');
      if (oaToggle) {
        oaToggle.classList.remove('is-on');
        oaToggle.setAttribute('aria-checked', 'false');
      }
      replaceStatus('');
      pos = { x: 820, y: 470 };
      paint();
    };

    const play = async (token) => {
      guard(token);
      reset(token);

      await press(demo.querySelector('.ddTbAgent'), token);
      demo.classList.add('is-open');
      await wait(620, token);

      const url = 'https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp';

      switch (agent) {
        case 'chatgpt': {
          await press(demo.querySelector('.railFoot'), token);
          demo.classList.add('is-menu');
          await wait(260, token);
          await press(demo.querySelector('#menuSettings'), token);
          demo.classList.remove('is-menu');
          demo.classList.add('is-settings');
          await wait(430, token);
          await press(demo.querySelector('.advRow'), token);
          demo.classList.add('is-advanced');
          await wait(430, token);
          const devToggle = demo.querySelector('.devModeToggle');
          await press(devToggle, token);
          devToggle.classList.add('is-on');
          devToggle.setAttribute('aria-checked', 'true');
          const createBtn = demo.querySelector('#advCreate2');
          createBtn.disabled = false;
          createBtn.classList.add('is-enabled');
          await wait(320, token);
          await press(createBtn, token);
          demo.classList.remove('is-advanced');
          demo.classList.add('is-appform');
          await wait(430, token);
          const nameField = demo.querySelector('#fieldName');
          const nameText = demo.querySelector('#dpNameText');
          await press(nameField, token);
          nameField.classList.add('is-on', 'has-value');
          for (const char of 'Opera Agent') {
            nameText.textContent += char;
            await wait(TYPE_PACE + 6, token);
          }
          nameField.classList.remove('is-on');
          const urlField = demo.querySelector('#fieldUrl');
          const urlText = demo.querySelector('#dpUrlText');
          await press(urlField, token);
          urlField.classList.add('is-on', 'has-value');
          urlText.textContent = url;
          await wait(650, token);
          urlField.classList.remove('is-on');
          const understand = demo.querySelector('#dpUnderstand');
          await press(understand, token);
          understand.classList.add('is-checked');
          understand.setAttribute('aria-checked', 'true');
          const finish = demo.querySelector('#newAppCreate');
          finish.disabled = false;
          finish.classList.add('is-enabled');
          await wait(300, token);
          await press(finish, token);
          demo.classList.remove('is-appform');
          demo.classList.add('is-authing');
          await wait(560, token);
          await press(demo.querySelector('.oauthAuth'), token);
          demo.classList.remove('is-authing');
          await wait(150, token);
          demo.classList.add('is-row');
          await wait(950, token);
          await press(demo.querySelector('.settingsClose'), token);
          demo.classList.remove('is-settings', 'is-row');
          await wait(360, token);
          await press(demo.querySelector('.composerAdd'), token);
          demo.classList.add('is-toolsmenu');
          await wait(320, token);
          const oaToggle = demo.querySelector('#oaMenuToggle');
          await press(oaToggle, token);
          oaToggle.classList.add('is-on');
          oaToggle.setAttribute('aria-checked', 'true');
          demo.classList.add('is-toggled');
          await wait(650, token);
          await press(demo.querySelector('.composerPh'), token);
          demo.classList.remove('is-toolsmenu');
          await wait(240, token);
          demo.classList.add('is-writing');
          const typed = demo.querySelector('#composerTyped');
          typed.textContent = '';
          for (const char of 'Summarize the Q3 sales sheet and post it to Slack') {
            typed.textContent += char;
            await wait(TYPE_PACE + 12, token);
          }
          demo.classList.add('is-ready');
          await wait(280, token);
          await press(demo.querySelector('.composerSend'), token);
          typed.textContent = '';
          demo.classList.remove('is-writing', 'is-ready');
          demo.classList.add('is-sent', 'is-usermsg');
          await wait(950, token);
          demo.classList.add('is-solid');
          await wait(2300, token);
          break;
        }
        case 'claude': {
          await press(demo.querySelector('.ccRailBriefcase'), token);
          demo.classList.add('is-customize');
          await wait(380, token);
          await press(demo.querySelector('#ccConnectAppsBtn'), token);
          demo.classList.remove('is-customize');
          demo.classList.add('is-connectors');
          await wait(400, token);
          await press(demo.querySelector('#ccAddBtn'), token);
          demo.classList.add('is-addpopover');
          await wait(300, token);
          await press(demo.querySelector('#ccAddCustomBtn'), token);
          demo.classList.remove('is-addpopover');
          demo.classList.add('is-adddialog');
          await wait(430, token);
          const nameField = demo.querySelector('#ccFieldName');
          const nameText = demo.querySelector('#ccNameText');
          await press(nameField, token);
          nameField.classList.add('is-on', 'has-value');
          for (const char of 'Opera Agent') {
            nameText.textContent += char;
            await wait(TYPE_PACE + 6, token);
          }
          nameField.classList.remove('is-on');
          const urlField = demo.querySelector('#ccFieldUrl');
          const urlText = demo.querySelector('#ccUrlText');
          await press(urlField, token);
          urlField.classList.add('is-on', 'has-value');
          urlText.textContent = url;
          await wait(650, token);
          urlField.classList.remove('is-on');
          const addBtn = demo.querySelector('#ccDialogAddBtn');
          addBtn.disabled = false;
          addBtn.classList.add('is-enabled');
          await wait(220, token);
          await press(addBtn, token);
          demo.classList.remove('is-adddialog');
          demo.classList.add('is-added');
          await wait(560, token);
          await press(demo.querySelector('#ccConnectBtn'), token);
          demo.classList.add('is-authing');
          await wait(560, token);
          await press(demo.querySelector('#ccOauthAuthorize'), token);
          demo.classList.remove('is-authing', 'is-added');
          demo.classList.add('is-connected');
          await wait(900, token);
          await press(demo.querySelector('.ccBackRow'), token);
          demo.classList.remove('is-connectors');
          demo.classList.add('is-customize');
          await wait(300, token);
          await press(demo.querySelector('.ccBackRow'), token);
          demo.classList.remove('is-customize', 'is-connected');
          await wait(380, token);
          await press(demo.querySelector('.ccPlus'), token);
          demo.classList.add('is-menu');
          await wait(320, token);
          const oaToggle = demo.querySelector('#ccOaMenuToggle');
          await press(oaToggle, token);
          oaToggle.classList.add('is-on');
          oaToggle.setAttribute('aria-checked', 'true');
          demo.classList.add('is-toggled');
          await wait(650, token);
          await press(demo.querySelector('.composerPh'), token);
          demo.classList.remove('is-menu');
          await wait(240, token);
          demo.classList.add('is-writing');
          const typed = demo.querySelector('#ccComposerTyped');
          typed.textContent = '';
          for (const char of 'Summarize the Q3 sales sheet and post it to Slack') {
            typed.textContent += char;
            await wait(TYPE_PACE + 12, token);
          }
          demo.classList.add('is-ready');
          await wait(280, token);
          await press(demo.querySelector('.ccSend'), token);
          typed.textContent = '';
          demo.classList.remove('is-writing', 'is-ready');
          demo.classList.add('is-sent', 'is-usermsg');
          await wait(950, token);
          demo.classList.add('is-solid');
          await wait(2300, token);
          break;
        }
        case 'codex': {
          const cat = lines[0];
          const block = lines[1];
          const codex = lines[2];
          const slash = lines[3];
          const done = lines[4];
          await typeLine(cat, token, TYPE_PACE);
          await wait(320, token);
          reveal(block, token);
          await wait(340, token);
          await typeLine(codex, token, TYPE_PACE + 4);
          await wait(260, token);
          await typeLine(slash, token, TYPE_PACE + 20);
          await wait(300, token);
          reveal(done, token);
          break;
        }
        case 'claude-code': {
          const command = lines[0];
          const added = lines[1];
          const claude = lines[2];
          const ready = lines[3];
          await typeLine(command, token, TYPE_PACE);
          await wait(340, token);
          reveal(added, token);
          await wait(260, token);
          await typeLine(claude, token, TYPE_PACE + 4);
          reveal(ready, token);
          break;
        }
        case 'terminal': {
          const npm = lines[0];
          const added = lines[1];
          const doctor = lines[2];
          const verdict = lines[3];
          await typeLine(npm, token, TYPE_PACE);
          await wait(360, token);
          reveal(added, token);
          await wait(300, token);
          await typeLine(doctor, token, TYPE_PACE);
          await wait(340, token);
          reveal(verdict, token);
          break;
        }
        case 'opencode': {
          const termCmd = demo.querySelector('#ocTermType');
          const termDim = demo.querySelector('#ocTermDim');
          const termOk = demo.querySelector('#ocTermOk');
          const terminal = demo.querySelector('#ocTerminal');
          const welcome = demo.querySelector('#ocWelcome');
          const toolCard = demo.querySelector('#ocToolCard');
          const metaRow = demo.querySelector('#ocMetaRow');
          const working = demo.querySelector('#ocWorkingRow');
          const shellCmd = demo.querySelector('#ocTermCmd');
          const outDim = demo.querySelector('#ocOutDim');
          const outOk = demo.querySelector('#ocOutOk');
          const full = 'opencode mcp add opera-agent --url https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp';

          termCmd.textContent = '';
          shellCmd.textContent = '';
          if (termDim) termDim.classList.remove('is-on');
          if (termOk) termOk.classList.remove('is-on');
          if (outDim) outDim.classList.remove('is-on');
          if (outOk) outOk.classList.remove('is-on');
          if (working) working.style.visibility = 'hidden';
          if (terminal) terminal.style.display = 'none';
          if (welcome) welcome.style.display = '';
          if (toolCard) toolCard.style.display = 'none';
          if (metaRow) metaRow.style.display = 'none';

          const composer = demo.querySelector('.ocComposerBig');
          await press(composer, token);
          await wait(160, token);
          demo.classList.add('is-writing');
          const typed = demo.querySelector('#deskComposerTyped');
          typed.textContent = '';
          for (const char of '/terminal') {
            typed.textContent += char;
            await wait(TYPE_PACE + 8, token);
          }
          demo.classList.add('is-ready', 'is-slash-terminal');
          await wait(560, token);
          await press(demo.querySelector('.ocSlashTerminal'), token);
          typed.textContent = '';
          demo.classList.remove('is-writing', 'is-ready', 'is-slash-terminal');
          if (welcome) welcome.style.display = 'none';
          if (terminal) { terminal.style.display = ''; const row = demo.querySelector('#ocSplitRow'); if (row) row.classList.add('has-terminal'); }

          await wait(200, token);
          for (const char of full) {
            termCmd.textContent += char;
            await wait(4, token);
          }
          if (working) working.style.visibility = 'visible';
          await wait(420, token);
          if (termDim) termDim.classList.add('is-on');
          await wait(430, token);
          if (termOk) termOk.classList.add('is-on');
          await wait(300, token);
          if (working) working.style.visibility = 'hidden';
          if (toolCard) toolCard.style.display = '';
          if (metaRow) metaRow.style.display = '';
          shellCmd.textContent = full;
          await wait(160, token);
          if (outDim) outDim.classList.add('is-on');
          await wait(180, token);
          if (outOk) outOk.classList.add('is-on');
          await wait(420, token);

          await press(composer, token);
          await wait(150, token);
          demo.classList.add('is-writing');
          typed.textContent = '';
          for (const char of '/mcp') {
            typed.textContent += char;
            await wait(TYPE_PACE + 9, token);
          }
          demo.classList.add('is-ready', 'is-slash-mcp');
          await wait(540, token);
          await press(demo.querySelector('.ocSlashMcp'), token);
          typed.textContent = '';
          demo.classList.remove('is-writing', 'is-ready', 'is-slash-mcp');
          demo.classList.add('is-mcps');
          await wait(750, token);

          await press(demo.querySelector('#mcpSignIn'), token);
          demo.classList.add('is-browser');
          await wait(1100, token);
          await press(demo.querySelector('#consentAllow'), token);
          demo.classList.add('is-authed');
          await wait(1400, token);
          demo.classList.remove('is-browser', 'is-authed');
          demo.classList.add('is-connected');
          await wait(1500, token);
          break;
        }
        case 'opencode-cli': {
          const [addLine, needAuth, listLine, needAuth2, authLine, connectedLine] = lines;
          await press(addLine, token);
          await typeLine(addLine, token, TYPE_PACE);
          await wait(340, token);
          reveal(needAuth, token);
          await wait(300, token);
          await typeLine(listLine, token, TYPE_PACE);
          await wait(260, token);
          reveal(needAuth2, token);
          await wait(380, token);
          await typeLine(authLine, token, TYPE_PACE);
          await wait(240, token);
          demo.classList.add('is-browser');
          await wait(1000, token);
          await press(demo.querySelector('#ocCliConsentAllow'), token);
          demo.classList.add('is-authed');
          reveal(connectedLine, token);
          await wait(1500, token);
          demo.classList.remove('is-browser', 'is-authed');
          demo.classList.add('is-connected');
          await wait(1500, token);
          break;
        }
        case 'vscode':
        case 'cursor': {
          await press(demo.querySelector('.ddFileTab'), token);
          await wait(420, token);
          replaceStatus(TOAST);
          break;
        }
        case 'kilo': {
          const kiloMeta = demo.querySelector('#kiloMeta');
          await press(demo.querySelector('#kiloSignIn'), token);
          demo.classList.add('is-browser');
          await wait(1000, token);
          await press(demo.querySelector('#kiloConsentAllow'), token);
          demo.classList.add('is-authed');
          if (kiloMeta) kiloMeta.textContent = 'Connected · 35 tools';
          await wait(1500, token);
          demo.classList.remove('is-browser', 'is-authed');
          demo.classList.add('is-connected');
          await wait(1600, token);
          break;
        }
        case 'fastlane': {
          const composer = demo.querySelector('.ocComposer');
          await press(composer, token);
          await wait(120, token);
          demo.classList.add('is-writing');
          const typed = demo.querySelector('#ocComposerTyped');
          typed.textContent = '';
          const prompt = 'Pasang MCP server Opera Agent dari https://nenmkmtvjremqphfqnfw.supabase.co/functions/v1/opera-agent-mcp — verifikasi terhubung.';
          for (const char of prompt) {
            typed.textContent += char;
            await wait(TYPE_PACE + 8, token);
          }
          demo.classList.add('is-ready');
          await wait(320, token);
          await press(demo.querySelector('.ocSendBtn'), token);
          typed.textContent = '';
          demo.classList.remove('is-writing', 'is-ready');
          demo.classList.add('is-sent');
          await wait(700, token);
          demo.classList.add('is-solid');
          await wait(2600, token);
          break;
        }
      }

      await wait(420, token);
      demo.classList.add('is-done');
      await wait(1800, token);
    };

    const loop = async () => {
      const token = ++generation;
      try {
        for (;;) {
          await play(token);
          if (token !== generation) return;
          await wait(1500, token);
        }
      } catch (error) {
        if (!(error instanceof Restart)) throw error;
      }
    };

    const restart = () => {
      generation++;
      cursor.getAnimations().forEach((animation) => animation.cancel());
      window.setTimeout(() => {
        void loop();
      }, 200);
    };

    const observer = new IntersectionObserver(([entry]) => {
      const next = entry.isIntersecting;
      if (next === visible) return;
      visible = next;
      if (visible) {
        fit();
        void loop();
      } else {
        generation++;
        cursor.getAnimations().forEach((animation) => animation.cancel());
      }
    }, { threshold: 0.2 });
    observer.observe(demo);

    let resize;
    window.addEventListener('resize', () => {
      window.clearTimeout(resize);
      resize = window.setTimeout(restart, 240);
    });

    fit();
  };

  const wireAll = () => {
    for (const demo of document.querySelectorAll('.mcpDemo[data-agent]')) wire(demo);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wireAll);
  else wireAll();
})();
