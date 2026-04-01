/**
 * app.js  –  パネル管理・メインアプリケーション
 *
 * 各パネルは独立した WebSocket 接続を持ち、
 * 複数パネルを同時に実行できる。
 */

"use strict";

// ===== グローバル状態 ==============================================
let algorithms  = [];    // [{ id, name }, ...]
let dataSizes   = [];    // [16, 32, ...]
let conditions  = [];    // [{ id, name }, ...]
let panelSeq    = 0;     // パネル ID 採番

// ===== 起動 ========================================================
window.addEventListener("DOMContentLoaded", async () => {
  await loadMeta();
  document.getElementById("btn-add-panel").addEventListener("click", addPanel);
  document.getElementById("btn-start-all").addEventListener("click", startAll);
  document.getElementById("btn-stop-all").addEventListener("click",  stopAll);
  addPanel(); // 初期パネルを1つ表示
});

async function loadMeta() {
  const [alRes, dsRes, cRes] = await Promise.all([
    fetch("/api/algorithms"),
    fetch("/api/datasizes"),
    fetch("/api/conditions"),
  ]);
  algorithms = await alRes.json();
  dataSizes  = await dsRes.json();
  conditions = await cRes.json();
}

// ===== パネル追加 ==================================================
function addPanel() {
  const id    = ++panelSeq;
  const panel = new SortPanel(id);
  panel.mount(document.getElementById("panels-container"));
}

// ===== 全開始 / 全停止 =============================================
function startAll() {
  document.querySelectorAll(".panel").forEach((el) => {
    const panel = el._panel;
    if (panel && !panel.isRunning) panel.start();
  });
}
function stopAll() {
  document.querySelectorAll(".panel").forEach((el) => {
    const el2 = el._panel;
    if (el2 && el2.isRunning) el2.stop();
  });
}

// ===================================================================
// SortPanel クラス
// ===================================================================
class SortPanel {
  constructor(id) {
    this.id        = id;
    this.sessionId = null;
    this.client    = null;
    this.sortCanvas= null;
    this.el        = null;
    this.isRunning = false;
    this.isPaused  = false;
    this.numItems  = 0;
    this.dataMax   = 0;
  }

  // ── DOM 構築 ────────────────────────────────────────────────────
  mount(container) {
    const el = document.createElement("div");
    el.className  = "panel";
    el._panel     = this;
    el.id         = `panel-${this.id}`;
    el.innerHTML  = this._template();
    container.appendChild(el);
    this.el = el;
    this._bind();
    this._populateSelects();
    this._onResize(); // 初期キャンバスサイズ
    return el;
  }

  _template() {
    return `
      <div class="panel-header">
        <span class="panel-title">パネル ${this.id}</span>
        <button class="panel-close" title="削除">✕</button>
      </div>

      <!-- パラメタ行 -->
      <div class="params-row">
        <label>アルゴリズム
          <select class="sel-algo"></select>
        </label>
      </div>
      <div class="params-row">
        <label>データ数
          <select class="sel-size"></select>
        </label>
        <label>初期状態
          <select class="sel-cond"></select>
        </label>
        <div class="speed-group">
          <label>速度</label>
          <input type="range" class="rng-speed" min="1" max="200" value="80"
                 title="大きいほど速い">
          <span class="speed-value">×1.0</span>
        </div>
      </div>

      <!-- コントロールボタン -->
      <div class="controls-row">
        <button class="btn btn-primary  btn-start">▶ 開始</button>
        <button class="btn btn-warning  btn-pause" disabled>⏸ 一時停止</button>
        <button class="btn btn-danger   btn-stop"  disabled>⏹ 停止</button>
        <button class="btn btn-secondary btn-reset" disabled>↺ リセット</button>
      </div>

      <!-- キャンバス -->
      <div class="canvas-wrapper">
        <canvas class="sort-canvas"></canvas>
      </div>

      <!-- テキストオーバーレイ -->
      <div class="text-overlay">（開始ボタンを押してください）</div>

      <!-- ステータス -->
      <div class="status-bar">
        <span class="status-algo">-</span>
        <span class="status-state">待機中</span>
        <span class="status-frames">フレーム: 0</span>
      </div>
    `;
  }

  // ── セレクトを動的に生成 ─────────────────────────────────────
  _populateSelects() {
    const selAlgo = this.el.querySelector(".sel-algo");
    algorithms.forEach(a => {
      const opt = new Option(a.name, a.id);
      selAlgo.appendChild(opt);
    });
    // デフォルト: パネルIDに応じてアルゴリズムを分散
    selAlgo.value = (this.id - 1) % algorithms.length;

    const selSize = this.el.querySelector(".sel-size");
    dataSizes.forEach(s => {
      const opt = new Option(String(s), s);
      selSize.appendChild(opt);
    });
    selSize.value = 32;

    const selCond = this.el.querySelector(".sel-cond");
    conditions.forEach(c => {
      const opt = new Option(c.name, c.id);
      selCond.appendChild(opt);
    });
  }

  // ── イベントバインド ─────────────────────────────────────────
  _bind() {
    const q = (sel) => this.el.querySelector(sel);

    q(".panel-close").addEventListener("click", () => this.destroy());
    q(".btn-start")  .addEventListener("click", () => this.start());
    q(".btn-pause")  .addEventListener("click", () => this.togglePause());
    q(".btn-stop")   .addEventListener("click", () => this.stop());
    q(".btn-reset")  .addEventListener("click", () => this.reset());

    q(".rng-speed").addEventListener("input", (ev) => {
      this._applySpeed(Number(ev.target.value));
    });

    // パネル全体 & キャンバスラッパー両方を監視（resize: both に対応）
    const ro = new ResizeObserver(() => this._onResize());
    ro.observe(this.el);
    ro.observe(q(".canvas-wrapper"));
  }

  _onResize() {
    const wrapper = this.el.querySelector(".canvas-wrapper");
    const canvas  = this.el.querySelector(".sort-canvas");
    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    if (w <= 0 || h <= 0) return;
    // canvas の論理サイズをラッパーの実サイズに合わせる
    canvas.width  = w;
    canvas.height = h;
    // SortCanvas も新サイズで再生成してフレームを再描画
    if (this.sortCanvas) {
      this.sortCanvas.canvas   = canvas;
      this.sortCanvas.ctx      = canvas.getContext("2d");
      this.sortCanvas.numItems = this.numItems;
      this.sortCanvas.dataMax  = this.dataMax;
    }
    if (this.sortCanvas && this._lastFrame) {
      this.sortCanvas.draw(this._lastFrame);
    }
  }

  // ── スピード変換: スライダー(1-200) → 秒/フレーム ──────────
  _applySpeed(sliderVal) {
    // スライダー右 = 速い = 秒数小
    const speed  = Math.round(200 / sliderVal * 10) / 1000; // 0.001 ~ 2.0
    const mult   = Math.round(sliderVal / 80 * 10) / 10;
    this.el.querySelector(".speed-value").textContent = `×${mult.toFixed(1)}`;
    if (this.client) this.client.setSpeed(speed);
    this._speed = speed;
  }

  _currentSpeed() {
    const v = Number(this.el.querySelector(".rng-speed").value);
    return Math.round(200 / v * 10) / 1000;
  }

  // ── 開始 ────────────────────────────────────────────────────────
  async start() {
    if (this.isRunning) return;

    const algoId = Number(this.el.querySelector(".sel-algo").value);
    const numItems = Number(this.el.querySelector(".sel-size").value);
    const condId = Number(this.el.querySelector(".sel-cond").value);
    const speed  = this._currentSpeed();

    // サーバーにセッション開始を要求
    let info;
    try {
      const res = await fetch("/api/start", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          algorithm_id:   algoId,
          num_items:      numItems,
          data_condition: condId,
          speed:          speed,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      info = await res.json();
    } catch (e) {
      this._setStatus(`エラー: ${e.message}`, "red");
      return;
    }

    this.sessionId = info.session_id;
    this.numItems  = info.num_items;
    this.dataMax   = info.data_max;
    this.isRunning = true;
    this.isPaused  = false;
    this._frameCount = 0;

    // キャンバスを初期化
    const canvas = this.el.querySelector(".sort-canvas");
    this.sortCanvas = new SortCanvas(canvas, this.numItems, this.dataMax);

    // UI 更新
    this.el.querySelector(".panel-title").textContent = info.algo_name;
    this.el.classList.add("running");
    this.el.classList.remove("finished");
    this._setStatus("実行中", "#90caf9");
    this._setBtns({ start: false, pause: true, stop: true, reset: false });
    this.el.querySelector(".status-algo").textContent = info.algo_name;
    this.el.querySelector(".text-overlay").textContent = "アニメーション開始...";

    // WebSocket 接続
    this.client = new AnimationClient(
      this.sessionId,
      (frame) => this._onFrame(frame),
      ()      => this._onClose(),
      (ev)    => this._setStatus("接続エラー", "red"),
    );
    this.client.connect();
  }

  // ── フレーム受信 ─────────────────────────────────────────────
  _onFrame(frame) {
    this._lastFrame  = frame;
    this._frameCount = (this._frameCount ?? 0) + 1;

    const texts = this.sortCanvas.draw(frame);
    this.el.querySelector(".text-overlay").textContent =
      texts.length ? texts.join("\n") : "";
    this.el.querySelector(".status-frames").textContent =
      `フレーム: ${this._frameCount}`;

    if (frame.finished) {
      this.isRunning = false;
      this.el.classList.remove("running");
      this.el.classList.add("finished");
      this._setStatus("完了", "#44aa44");
      this._setBtns({ start: false, pause: false, stop: false, reset: true });
    }
  }

  // ── WebSocket クローズ ────────────────────────────────────────
  _onClose() {
    if (this.isRunning) {
      this.isRunning = false;
      this.el.classList.remove("running");
      this._setStatus("切断", "#888");
      this._setBtns({ start: true, pause: false, stop: false, reset: false });
    }
  }

  // ── 一時停止 / 再開 ────────────────────────────────────────────
  togglePause() {
    if (!this.isRunning) return;
    this.isPaused = !this.isPaused;
    const btn = this.el.querySelector(".btn-pause");
    if (this.isPaused) {
      this.client.pause();
      btn.textContent = "▶ 再開";
      this._setStatus("一時停止", "#FFD700");
    } else {
      this.client.resume();
      btn.textContent = "⏸ 一時停止";
      this._setStatus("実行中", "#90caf9");
    }
  }

  // ── 停止 ─────────────────────────────────────────────────────
  stop() {
    if (!this.isRunning) return;
    this.client?.stop();
    this.client?.disconnect();
    this.client    = null;
    this.isRunning = false;
    this.el.classList.remove("running");
    this._setStatus("停止", "#888");
    this._setBtns({ start: true, pause: false, stop: false, reset: true });
  }

  // ── リセット ─────────────────────────────────────────────────
  reset() {
    if (this.isRunning) this.stop();
    const canvas = this.el.querySelector(".sort-canvas");
    const ctx    = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.el.querySelector(".text-overlay").textContent = "（開始ボタンを押してください）";
    this.el.querySelector(".status-frames").textContent = "フレーム: 0";
    this.el.classList.remove("finished");
    this._setStatus("待機中", "#888");
    this._setBtns({ start: true, pause: false, stop: false, reset: false });
    this.sortCanvas  = null;
    this._lastFrame  = null;
    this._frameCount = 0;
  }

  // ── パネル削除 ───────────────────────────────────────────────
  destroy() {
    this.stop();
    this.el?.remove();
  }

  // ── ヘルパー ─────────────────────────────────────────────────
  _setBtns({ start, pause, stop, reset }) {
    const q = (s) => this.el.querySelector(s);
    q(".btn-start").disabled = !start;
    q(".btn-pause").disabled = !pause;
    q(".btn-stop") .disabled = !stop;
    q(".btn-reset").disabled = !reset;
    if (!pause) q(".btn-pause").textContent = "⏸ 一時停止";
  }

  _setStatus(text, color = "#aaa") {
    const el = this.el.querySelector(".status-state");
    el.textContent = text;
    el.style.color = color;
  }
}
