import { Route, Vector } from "../core/types";

const streakRoute: Route = {
  breakAngle: 0,
  yardsBeforeBreak: 0,
  stopAfterBreak: false,
};
const postRoute: Route = {
  breakAngle: 45,
  yardsBeforeBreak: 15,
  stopAfterBreak: false,
};
const cornerRoute: Route = {
  breakAngle: -55,
  yardsBeforeBreak: 15,
  stopAfterBreak: false,
};
const inRoute: Route = {
  breakAngle: 90,
  yardsBeforeBreak: 10,
  stopAfterBreak: false,
};
const outRoute: Route = {
  breakAngle: -90,
  yardsBeforeBreak: 10,
  stopAfterBreak: false,
};
const curlRoute: Route = {
  breakAngle: 180,
  yardsBeforeBreak: 10,
  stopAfterBreak: true,
};
const slantRoute: Route = {
  breakAngle: 65,
  yardsBeforeBreak: 4,
  stopAfterBreak: false,
};
const dragRoute: Route = {
  breakAngle: 90,
  yardsBeforeBreak: 3,
  stopAfterBreak: false,
};
const flatRoute: Route = {
  breakAngle: -90,
  yardsBeforeBreak: 0,
  stopAfterBreak: false,
};

/** Returns a random route used to assign to a catcher */
export function randomRoute(): Route {
  const routes = [
    streakRoute,
    postRoute,
    cornerRoute,
    inRoute,
    outRoute,
    curlRoute,
    slantRoute,
    dragRoute,
    flatRoute,
  ];
  return routes[Math.floor(Math.random() * routes.length)];
}

/** Returns a random unit vector that designates a runner's angle */
export function randomRunVector(): Vector {
  // 1. Generate a random angle between +80 and -80
  const MAX_ANGLE_DEGREES = 60;
  const maxAngleRad = (MAX_ANGLE_DEGREES * Math.PI) / 180;
  const angle = (Math.random() * 2 - 1) * maxAngleRad;

  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

/** Converts a run angle Vector to a string key */
export function runAngleKey(runAngle: Vector): string {
  const degrees = Math.round(
    (Math.atan2(runAngle.y, runAngle.x) * 180) / Math.PI,
  );
  return `${degrees}°`;
}

export {
  cornerRoute,
  curlRoute,
  dragRoute,
  flatRoute,
  inRoute,
  outRoute,
  postRoute,
  slantRoute,
  streakRoute,
};
