// Esfera de Fibonacci determinista: sin texturas, recursos externos ni aleatoriedad por frame.
export function spherePoints(count) {
  return Array.from({length: count}, (_, i) => {
    const y = 1 - 2 * (i + .5) / count, radius = Math.sqrt(1 - y * y), angle = i * Math.PI * (3 - Math.sqrt(5));
    return {x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius, phase: i * 2.39996};
  });
}
