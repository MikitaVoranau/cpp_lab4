/**
 * Графический движок Aim Lab на Canvas
 * Отвечает за:
 * - Рендеринг интерактивной арены 1000x650
 * - Анимацию и отрисовку исчезающих мишеней с таймером
 * - Взрывы частиц при попадании
 * - Визуализацию лазерных прицелов других игроков
 * - Эффект коллизии/конфликта при одновременном выстреле
 */

class AimCanvas {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');

    // Логический размер арены для всех игроков
    this.arenaWidth = 1000;
    this.arenaHeight = 650;
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;

    this.targets = new Map(); // id => target
    this.remoteCursors = new Map(); // id => { x, y, name, color }
    this.particles = [];
    this.floatingTexts = [];
    this.conflictFlashes = [];

    this.mouseX = -100;
    this.mouseY = -100;
    this.myColor = '#00f5d4';

    this.onTargetClick = null; // callback(targetId, expectedVersion)
    this.onMissClick = null; // callback()
    this.onCursorMove = null; // callback(arenaX, arenaY)

    this.initEvents();
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.startLoop();
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    const rect = parent.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;

    // Сохраняем соотношение сторон арены (1000 x 650)
    const scaleX = this.canvas.width / this.arenaWidth;
    const scaleY = this.canvas.height / this.arenaHeight;
    this.scale = Math.min(scaleX, scaleY) * 0.96; // 96% для отступов

    this.offsetX = (this.canvas.width - this.arenaWidth * this.scale) / 2;
    this.offsetY = (this.canvas.height - this.arenaHeight * this.scale) / 2;
  }

  initEvents() {
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;

      const arenaX = (screenX - this.offsetX) / this.scale;
      const arenaY = (screenY - this.offsetY) / this.scale;

      this.mouseX = arenaX;
      this.mouseY = arenaY;

      if (this.onCursorMove && arenaX >= 0 && arenaX <= this.arenaWidth && arenaY >= 0 && arenaY <= this.arenaHeight) {
        this.onCursorMove(Math.round(arenaX), Math.round(arenaY));
      }
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return; // только ЛКМ

      const rect = this.canvas.getBoundingClientRect();
      const arenaX = (e.clientX - rect.left - this.offsetX) / this.scale;
      const arenaY = (e.clientY - rect.top - this.offsetY) / this.scale;

      // Проверяем попадание по мишеням (начиная с самых верхних)
      let hitTarget = null;
      for (const target of Array.from(this.targets.values()).reverse()) {
        const dx = arenaX - target.x;
        const dy = arenaY - target.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= target.radius) {
          hitTarget = target;
          break;
        }
      }

      if (hitTarget) {
        if (this.onTargetClick) {
          this.onTargetClick(hitTarget.id, hitTarget.version, arenaX, arenaY);
        }
      } else {
        if (this.onMissClick) {
          this.onMissClick();
        }
        // Создаем маленький всплеск промаха
        this.addMissParticle(arenaX, arenaY);
      }
    });

    // Для тачпадов и экранов
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const rect = this.canvas.getBoundingClientRect();
        const arenaX = (touch.clientX - rect.left - this.offsetX) / this.scale;
        const arenaY = (touch.clientY - rect.top - this.offsetY) / this.scale;

        for (const target of Array.from(this.targets.values()).reverse()) {
          const dx = arenaX - target.x;
          const dy = arenaY - target.y;
          if (Math.sqrt(dx * dx + dy * dy) <= target.radius) {
            if (this.onTargetClick) {
              this.onTargetClick(target.id, target.version, arenaX, arenaY);
            }
            return;
          }
        }
        if (this.onMissClick) this.onMissClick();
      }
    });
  }

  setTargets(targetsArray) {
    this.targets.clear();
    for (const t of targetsArray) {
      this.targets.set(t.id, t);
    }
  }

  addTarget(target) {
    this.targets.set(target.id, target);
  }

  removeTarget(targetId) {
    this.targets.delete(targetId);
  }

  addHitEffect(x, y, color, points) {
    // Взрыв частиц
    const count = 16;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 3,
        color,
        alpha: 1.0,
        decay: 0.03 + Math.random() * 0.02
      });
    }

    // Всплывающий текст очков
    const text = points > 0 ? `+${points}` : `${points}`;
    this.floatingTexts.push({
      x,
      y: y - 10,
      text,
      color: points > 0 ? color : '#ff4757',
      alpha: 1.0,
      vy: -1.6
    });
  }

  addMissParticle(x, y) {
    for (let i = 0; i < 6; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.5,
        color: '#ff4757',
        alpha: 0.7,
        decay: 0.06
      });
    }
  }

  addConflictFlash(x, y, conflict) {
    this.conflictFlashes.push({
      x,
      y,
      startTime: performance.now(),
      duration: 1200,
      text: `⚡ ОПЕРЕДИЛ: ${conflict.winnerPlayer} (-${conflict.deltaMs}мс)`
    });
  }

  updateRemoteCursor(playerId, x, y, name, color) {
    this.remoteCursors.set(playerId, { x, y, name, color });
  }

  removeRemoteCursor(playerId) {
    this.remoteCursors.delete(playerId);
  }

  startLoop() {
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  draw() {
    const ctx = this.ctx;
    const now = Date.now();
    const perfNow = performance.now();

    // 1. Очистка холста
    ctx.fillStyle = '#0a0c10';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // 2. Фон арены и киберспортивная сетка
    ctx.fillStyle = '#10141d';
    ctx.fillRect(0, 0, this.arenaWidth, this.arenaHeight);

    // Сетка
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = 1;
    const step = 50;
    ctx.beginPath();
    for (let x = 0; x <= this.arenaWidth; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.arenaHeight);
    }
    for (let y = 0; y <= this.arenaHeight; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(this.arenaWidth, y);
    }
    ctx.stroke();

    // Границы арены с неоновым свечением
    ctx.strokeStyle = '#00f5d4';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(0, 0, this.arenaWidth, this.arenaHeight);

    // 3. Отрисовка мишеней (Targets)
    for (const target of this.targets.values()) {
      const elapsed = now - target.spawnTime;
      const remainingRatio = Math.max(0, 1 - elapsed / target.lifetime);

      ctx.save();
      ctx.translate(target.x, target.y);

      // Внешнее пульсирующее кольцо таймера жизни
      ctx.strokeStyle = target.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, target.radius + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * remainingRatio);
      ctx.stroke();

      // Тело мишени (градиент)
      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, target.radius);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.4, target.color);
      grad.addColorStop(1, 'rgba(0, 0, 0, 0.7)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, target.radius, 0, Math.PI * 2);
      ctx.fill();

      // Внутреннее перекрестие мишени
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-target.radius * 0.5, 0);
      ctx.lineTo(target.radius * 0.5, 0);
      ctx.moveTo(0, -target.radius * 0.5);
      ctx.lineTo(0, target.radius * 0.5);
      ctx.stroke();

      // Иконка бомбы или бонус
      if (target.type === 'bomb') {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💣', 0, 0);
      } else if (target.type === 'golden') {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+40', 0, 0);
      }

      ctx.restore();
    }

    // 4. Отрисовка частиц взрывов
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay;

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 5. Отрисовка всплывающего текста
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= 0.025;

      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = ft.alpha;
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    // 6. Отрисовка вспышек конфликтов (Требование 1 дополнительно)
    for (let i = this.conflictFlashes.length - 1; i >= 0; i--) {
      const cf = this.conflictFlashes[i];
      const elapsed = perfNow - cf.startTime;
      if (elapsed > cf.duration) {
        this.conflictFlashes.splice(i, 1);
        continue;
      }

      const progress = elapsed / cf.duration;
      const alpha = 1 - progress;
      const radius = 20 + progress * 50;

      ctx.save();
      ctx.strokeStyle = `rgba(255, 71, 87, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cf.x, cf.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = 'bold 11px monospace';
      ctx.fillStyle = `rgba(255, 230, 0, ${alpha})`;
      ctx.textAlign = 'center';
      ctx.fillText(cf.text, cf.x, cf.y - radius - 6);
      ctx.restore();
    }

    // 7. Отрисовка курсоров других игроков
    for (const [id, remote] of this.remoteCursors.entries()) {
      ctx.save();
      ctx.translate(remote.x, remote.y);

      // Прицел
      ctx.strokeStyle = remote.color || '#ff0055';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.moveTo(-12, 0); ctx.lineTo(12, 0);
      ctx.moveTo(0, -12); ctx.lineTo(0, 12);
      ctx.stroke();

      // Бейдж имени
      ctx.font = '10px sans-serif';
      ctx.fillStyle = 'rgba(10, 12, 16, 0.85)';
      const textW = ctx.measureText(remote.name).width;
      ctx.fillRect(10, -16, textW + 8, 14);
      ctx.fillStyle = remote.color;
      ctx.fillText(remote.name, 14, -6);

      ctx.restore();
    }

    // 8. Собственный прицел игрока (Crosshair)
    if (this.mouseX >= 0 && this.mouseX <= this.arenaWidth && this.mouseY >= 0 && this.mouseY <= this.arenaHeight) {
      ctx.save();
      ctx.translate(this.mouseX, this.mouseY);

      ctx.strokeStyle = this.myColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.moveTo(-18, 0); ctx.lineTo(-6, 0);
      ctx.moveTo(6, 0); ctx.lineTo(18, 0);
      ctx.moveTo(0, -18); ctx.lineTo(0, -6);
      ctx.moveTo(0, 6); ctx.lineTo(0, 18);
      ctx.stroke();

      // Центральная точка
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    ctx.restore();
  }
}

window.AimCanvas = AimCanvas;
