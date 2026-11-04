// B1-07: archivo temporal para comprobar que el CI rechaza un error de lint. No se fusiona.
export function pruebaLint() {
  const sinUsar = 1;
  return 'el CI debe fallar por la variable sin usar';
}
