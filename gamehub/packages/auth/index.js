'use strict';

function isOwner(room, ownerToken) {
  return Boolean(room && ownerToken && room.ownerToken === ownerToken);
}

module.exports = {
  isOwner,
};
