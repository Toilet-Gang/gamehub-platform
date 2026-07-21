'use strict';

function createGameManifest(game) {
  return {
    id: game.id,
    name: game.name,
    route: game.route,
    status: game.status || 'placeholder',
    description: game.description || '',
  };
}

module.exports = {
  createGameManifest,
};
