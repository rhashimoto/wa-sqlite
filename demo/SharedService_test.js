import { SharedService, createSharedServicePort } from "./SharedService.js";

const target = {
  async add(x, y) {
    return x + y;
  }
};

function portProvider() {
  return createSharedServicePort(target);
}

(async function() {
  const sharedService = new SharedService('test', portProvider);
  sharedService.activate();
  const result = await sharedService.proxy.add(3, 4);
  console.log(result);
})();
