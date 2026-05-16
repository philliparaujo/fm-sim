import { Ball, Player, State } from "./types";
import { length } from "./util";

const W = 720;
const H = 400;
const GRASS_COLOR = "#66aa22";
const BALL_COLOR = "#8B4513";
const BALL_STROKE_COLOR = "#5a2d0c";
const BALL_LACE_COLOR = "rgba(255,255,255,0.6)";

const state: State = {
  ball: {
    position: { x: W / 2, y: H / 2 },
    velocity: { x: -2, y: 1 },
    radius: 8,
    strokeWidth: 0.8,
    laceWidth: 2,
  },
  players: [
    {
      position: { x: W / 2, y: H / 2 },
      velocity: { x: 1, y: 0 },
      radius: 10,
      color: "red",
    },
    {
      position: { x: W / 3, y: H / 3 },
      velocity: { x: 1, y: -1 },
      radius: 10,
      color: "red",
    },
    {
      position: { x: W / 2.5, y: H / 2.5 },
      velocity: { x: 1, y: -1.5 },
      radius: 10,
      color: "blue",
    },
  ],
};

const canvas = document.getElementById("field") as HTMLCanvasElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

canvas.width = W;
canvas.height = H;

function drawField() {
  ctx.fillStyle = GRASS_COLOR;
  ctx.fillRect(0, 0, W, H);
}

function drawBall() {
  ctx.beginPath();

  // Ball body (oval)
  ctx.save();
  ctx.translate(state.ball.position.x, state.ball.position.y);
  ctx.beginPath();
  ctx.ellipse(0, 0, state.ball.radius, state.ball.radius, 0, 0, Math.PI * 2);
  ctx.fillStyle = BALL_COLOR;
  ctx.fill();
  ctx.strokeStyle = BALL_STROKE_COLOR;
  ctx.lineWidth = state.ball.strokeWidth;
  ctx.stroke();

  // Lace
  ctx.strokeStyle = BALL_LACE_COLOR;
  ctx.lineWidth = state.ball.laceWidth;
  ctx.beginPath();
  ctx.moveTo(-state.ball.radius / 2, 0);
  ctx.lineTo(state.ball.radius / 2, 0);
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(player: Player) {
  ctx.beginPath();
  ctx.ellipse(
    player.position.x,
    player.position.y,
    player.radius,
    player.radius,
    0,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = player.color;
  ctx.fill();
}

function moveEntity(entity: Ball | Player) {
  entity.position.x += entity.velocity.x;
  entity.position.y += entity.velocity.y;

  const leftBound = 0 + entity.radius / 2;
  const rightBound = W - entity.radius / 2;
  const topBound = 0 + entity.radius / 2;
  const bottomBound = H - entity.radius / 2;

  if (entity.position.x < leftBound || entity.position.x > rightBound) {
    entity.velocity.x = -entity.velocity.x;
  }
  if (entity.position.y < topBound || entity.position.y > bottomBound) {
    entity.velocity.y = -entity.velocity.y;
  }
}

function resolveCollision(a: Ball | Player, b: Ball | Player) {
  // 1. Calculate the distance between centers
  const dx = b.position.x - a.position.x;
  const dy = b.position.y - a.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Sum of radii (the minimum distance they should be apart)
  const minDistance = a.radius + b.radius;

  if (distance < minDistance) {
    // 2. STATIC RESOLUTION: Prevent them from occupying same space
    // Calculate how much they are overlapping
    const overlap = minDistance - distance;

    // Normalize the direction vector
    const nx = dx / distance;
    const ny = dy / distance;

    // Move each entity away by half the overlap
    // (If one entity is "fixed", like a wall, move the other by 100% overlap)
    const moveX = nx * (overlap / 2);
    const moveY = ny * (overlap / 2);

    a.position.x -= moveX;
    a.position.y -= moveY;
    b.position.x += moveX;
    b.position.y += moveY;
  }
}

function stepSimulation() {
  // Change all players' velocity direction to follow ball
  for (const player of state.players) {
    const speed = length(player.velocity);
    const angle = Math.atan2(
      state.ball.position.y - player.position.y,
      state.ball.position.x - player.position.x
    );
    player.velocity.x = Math.cos(angle) * speed;
    player.velocity.y = Math.sin(angle) * speed;
  }

  // Move entities
  moveEntity(state.ball);
  for (const player of state.players) {
    moveEntity(player);
  }

  // Resolve collisions
  for (let i = 0; i < state.players.length; i++) {
    for (let j = i + 1; j < state.players.length; j++) {
      resolveCollision(state.players[i], state.players[j]);
    }
  }
}

/* High-level rendering functions */
function render() {
  drawField();
  for (const player of state.players) {
    drawPlayer(player);
  }
  drawBall();
}

function tick() {
  stepSimulation();
  render();
  requestAnimationFrame(tick);
}

export { tick };
