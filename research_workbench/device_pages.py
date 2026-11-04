"""Static device entry: no tenant lookup, workspace allocation or file fallback."""
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .ui_releases import delivery_for


class FrontendFiles(StaticFiles):
    async def get_response(self, path, scope):
        path = path.replace('\\', '/')
        delivery = delivery_for(self.directory)
        if path.startswith('_ui/'):
            return await delivery.asset(path[4:], scope)
        if path in ('', '.', 'index.html', 'recover.html', 'storage-choice.html'):
            return await run_in_threadpool(delivery.html, path if path.endswith('.html') else 'index.html')
        response = await super().get_response(path, scope)
        # Native ES module imports keep stable URLs across releases. Revalidate
        # them so an updated entry cannot reuse an incompatible old dependency.
        response.headers['Cache-Control'] = 'no-cache'
        return response


def install_device_pages(app, frontend):
    @app.get('/device', include_in_schema=False)
    def device_redirect():
        return RedirectResponse('/device/', status_code=307)

    @app.get('/device/', include_in_schema=False)
    def device_page():
        return delivery_for(frontend).html('index.html', device=True)

    @app.api_route('/device/files/{path:path}', methods=['GET', 'HEAD'], include_in_schema=False)
    def unavailable_device_file(path: str):
        # Only the scoped browser worker may resolve device data. Never serve a
        # same-named server file if that worker is unavailable.
        return Response(status_code=404, headers={'Cache-Control': 'no-store'})

    @app.get('/storage', include_in_schema=False)
    def storage_choice():
        return choice_response(frontend)


def choice_response(frontend):
    return delivery_for(frontend).html('storage-choice.html')
