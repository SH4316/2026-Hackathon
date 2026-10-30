"""환경 초기값과 별개로 관리 API에서 저장하는 런타임 모델 모드."""

from app.config import ModelMode, Settings
from app.org.settings import OrgSettingsStore


class RuntimeState:
    def __init__(self, settings: Settings, store: OrgSettingsStore | None = None) -> None:
        self.store = store
        self.endpoint_set = bool(settings.model_base_url.strip() and settings.model_name.strip())
        self._initial = store.model_mode(settings.model_mode) if store else settings.model_mode

    @property
    def model_mode(self) -> ModelMode:
        return self.store.model_mode(self._initial) if self.store else self._initial

    def set_model_mode(self, mode: ModelMode, actor: str) -> None:
        if self.store:
            self.store.set_model_mode(mode, actor)
        else:
            self._initial = mode
