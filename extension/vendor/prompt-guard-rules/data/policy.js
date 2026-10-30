// 자동 생성 파일: server/scripts/export_rules_bundle.py 로 갱신한다. 직접 수정하지 않는다.
export default {
  "_generated_from": "server/policies/default.yaml, destinations.yaml, detectors.yaml",
  "version": "2026-10-31.draft5",
  "model_required": false,
  "default": {
    "category": "uncategorized",
    "severity": "medium",
    "action": "warn"
  },
  "types": {
    "rrn": {
      "category": "personal_id",
      "severity": "critical",
      "action": "mask",
      "token": "RRN"
    },
    "passport": {
      "category": "personal_id",
      "severity": "critical",
      "action": "mask",
      "token": "PASSPORT"
    },
    "driver_license": {
      "category": "personal_id",
      "severity": "critical",
      "action": "mask",
      "token": "DRIVER_LICENSE"
    },
    "phone": {
      "category": "personal",
      "severity": "medium",
      "action": "mask",
      "token": "PHONE"
    },
    "email": {
      "category": "personal",
      "severity": "medium",
      "action": "mask",
      "token": "EMAIL"
    },
    "id_number": {
      "category": "personal_id",
      "severity": "medium",
      "action": "warn",
      "token": "ID_NUM"
    },
    "street_address": {
      "category": "personal",
      "severity": "high",
      "action": "mask",
      "token": "ADDRESS"
    },
    "url_personal": {
      "category": "personal",
      "severity": "medium",
      "action": "warn",
      "token": "URL_PERSONAL"
    },
    "username": {
      "category": "personal",
      "severity": "medium",
      "action": "warn",
      "token": "USERNAME"
    },
    "credit_card": {
      "category": "financial",
      "severity": "critical",
      "action": "mask",
      "token": "CARD"
    },
    "bank_account": {
      "category": "financial",
      "severity": "high",
      "action": "mask",
      "token": "ACCOUNT"
    },
    "aws_access_key_id": {
      "category": "credential",
      "severity": "critical",
      "action": "mask",
      "token": "AWS_KEY"
    },
    "github_token": {
      "category": "credential",
      "severity": "critical",
      "action": "mask",
      "token": "GITHUB_TOKEN"
    },
    "jwt": {
      "category": "credential",
      "severity": "critical",
      "action": "mask",
      "token": "JWT"
    },
    "private_key": {
      "category": "credential",
      "severity": "critical",
      "action": "mask",
      "token": "PRIVATE_KEY"
    },
    "password": {
      "category": "credential",
      "severity": "critical",
      "action": "mask",
      "token": "PASSWORD"
    },
    "secret_config_value": {
      "category": "credential",
      "severity": "high",
      "action": "mask",
      "token": "SECRET"
    },
    "url_with_credentials": {
      "category": "credential",
      "severity": "critical",
      "action": "mask",
      "token": "URL"
    },
    "internal_ip": {
      "category": "infrastructure",
      "severity": "medium",
      "action": "warn",
      "token": "INTERNAL_IP"
    },
    "internal_cidr": {
      "category": "infrastructure",
      "severity": "medium",
      "action": "warn",
      "token": "INTERNAL_CIDR"
    },
    "internal_domain": {
      "category": "infrastructure",
      "severity": "medium",
      "action": "warn",
      "token": "INTERNAL_HOST"
    },
    "ip_address": {
      "category": "infrastructure",
      "severity": "low",
      "action": "allow",
      "token": "IP"
    },
    "cidr": {
      "category": "infrastructure",
      "severity": "low",
      "action": "allow",
      "token": "CIDR"
    },
    "mac_address": {
      "category": "infrastructure",
      "severity": "low",
      "action": "warn",
      "token": "MAC"
    },
    "url": {
      "category": "infrastructure",
      "severity": "info",
      "action": "allow",
      "token": "URL"
    },
    "cve": {
      "category": "security",
      "severity": "info",
      "action": "allow",
      "token": "CVE"
    }
  },
  "destinations": {
    "default_tier": "elevated",
    "stale_after_days": 90,
    "tiers": {
      "standard": {},
      "elevated": {},
      "restricted": {}
    },
    "org_contracts": [],
    "profiles": {
      "anthropic": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "elevated",
            "basis": "설정 ON 시 학습, 학습 ON이면 비식별 데이터 최대 5년 보관"
          },
          "enterprise": {
            "tier": "standard",
            "basis": "상업용(Team·Enterprise) 학습 안 함"
          },
          "api": {
            "tier": "standard",
            "basis": "명시적 허가 없이 학습 안 함, Covered Models는 30일 보존"
          },
          "cloud": {
            "tier": "standard",
            "basis": "제3자 플랫폼 상업 조건, 학습 안 함"
          }
        }
      },
      "openai": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "elevated",
            "basis": "ChatGPT 소비자 학습 정책 확인 불가(403)"
          },
          "enterprise": {
            "tier": "standard",
            "basis": "비즈니스 데이터 기본 학습 안 함"
          },
          "api": {
            "tier": "standard",
            "basis": "opt-in 없이는 학습 안 함, 남용 모니터링 로그 최대 30일"
          }
        }
      },
      "google": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "elevated",
            "basis": "Keep Activity ON 시 학습, 기본 18개월 보관, 사람 검토 대화 최대 3년"
          },
          "api_free": {
            "tier": "elevated",
            "basis": "무료 API: 제품·ML 개선에 사용, 사람 검토 가능"
          },
          "api": {
            "tier": "standard",
            "basis": "유료 API: 제품 개선에 사용 안 함(남용 감시 로그 기간 미명시, 검색·지도 그라운딩은 30일 저장·끌 수 없음)"
          },
          "cloud": {
            "tier": "standard",
            "basis": "Vertex AI: 엔터프라이즈 DPA·ZDR 경로"
          }
        }
      },
      "meta": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "elevated",
            "basis": "AI 기능과의 상호작용을 학습에 사용, 계정 단위 opt-out 미확인"
          },
          "self_hosted": {
            "tier": "standard",
            "basis": "Llama 자체 호스팅(외부 전송 없음 주장은 공식 문서 근거 아님)"
          }
        }
      },
      "xai": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "elevated",
            "basis": "소비자 Grok 학습 정책 확인 불가"
          },
          "enterprise": {
            "tier": "standard",
            "basis": "API 입출력 학습 안 함, 요청·응답 30일 감사 저장"
          },
          "api": {
            "tier": "standard",
            "basis": "API 입출력 학습 안 함"
          }
        }
      },
      "deepseek": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "restricted",
            "basis": "PRC 처리·저장 명시([충돌]), 비식별 후 개선에 사용, 고정 보관 기간 없음"
          },
          "api": {
            "tier": "restricted",
            "basis": "PRC 처리·저장 명시([충돌]), 계정 존속 기간 보관"
          }
        }
      },
      "moonshot": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "restricted",
            "basis": "학습·최적화를 처리 목적으로 명시, 서버 위치 [충돌]"
          },
          "api": {
            "tier": "restricted",
            "basis": "학습 사용 여부·서버 위치가 문서 간 [충돌]"
          }
        }
      },
      "mistral": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "elevated",
            "basis": "Vibe(구 Le Chat) 입출력 기본 학습(opt-out 가능), 삭제 전까지 보관"
          },
          "enterprise": {
            "tier": "standard",
            "basis": "Vibe Enterprise 기본 opt-out"
          },
          "api": {
            "tier": "elevated",
            "basis": "기본 학습 안 함(Commercial Terms 4.2)이나 기본 opt-in 제품·Studio Free·Labs 모델 예외, Pay-as-you-go 기본값 미명시, 30일 롤링 보관"
          }
        }
      },
      "cohere": {
        "verified_at": "2026-10-31",
        "channels": {
          "api": {
            "tier": "elevated",
            "basis": "SaaS 30일 보관, 학습 기본값 미확인"
          },
          "enterprise": {
            "tier": "standard",
            "basis": "엔터프라이즈 계약·DPA가 규율"
          }
        }
      },
      "amazon": {
        "verified_at": "2026-10-31",
        "channels": {
          "cloud": {
            "tier": "standard",
            "basis": "Bedrock 입출력을 학습에 쓰지 않고 모델 제공사와 공유 안 함"
          }
        }
      },
      "perplexity": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "elevated",
            "basis": "소비자 플랜 학습 정책 확인 불가"
          },
          "enterprise": {
            "tier": "standard",
            "basis": "엔터프라이즈 데이터 학습·파인튜닝 안 함"
          },
          "api": {
            "tier": "standard",
            "basis": "API 약관상 Customer Content 학습 안 함(제품별 약관에 따라 다를 수 있음)"
          }
        }
      },
      "microsoft": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "elevated",
            "basis": "개인 계정 학습 opt-out 방식, 대화 18개월 보관"
          },
          "enterprise": {
            "tier": "standard",
            "basis": "테넌트 관리자 opt-in 없으면 학습 안 함"
          }
        }
      },
      "alibaba": {
        "verified_at": "2026-10-31",
        "channels": {
          "consumer": {
            "tier": "elevated",
            "basis": "Qwen Chat: 비식별 콘텐츠를 학습에 사용 가능"
          },
          "api": {
            "tier": "standard",
            "basis": "Model Studio: 학습 안 함, 최대 30일 보관"
          },
          "self_hosted": {
            "tier": "standard",
            "basis": "Qwen 가중치 자체 호스팅"
          }
        }
      }
    }
  },
  "ruleset": {
    "ruleset_version": 1,
    "policy_version": "2026-10-31.draft5",
    "updated_at": "1970-01-01T00:00:00+00:00",
    "modules": {
      "custom_rules": true,
      "context_model": true
    },
    "custom_rules": [
      {
        "id": "confidential_marker",
        "label": "기밀 표식",
        "category": "confidential",
        "severity": "high",
        "action": "warn",
        "token": "CONFIDENTIAL_MARK",
        "enabled": true,
        "kind": "keywords",
        "keywords": [
          "대외비",
          "사내한",
          "극비",
          "Confidential",
          "Internal Only",
          "Do Not Distribute"
        ],
        "pattern": null,
        "case_sensitive": false,
        "reason": "문서에 기밀 표식 문구가 있음"
      }
    ],
    "context_detectors": [
      {
        "id": "unpublished_research",
        "label": "미공개 연구 결과",
        "category": "confidential",
        "severity": "high",
        "action": "block",
        "token": "RESEARCH",
        "enabled": true
      },
      {
        "id": "internal_project",
        "label": "내부 프로젝트 정보",
        "category": "confidential",
        "severity": "medium",
        "action": "mask",
        "token": "PROJECT",
        "enabled": true
      },
      {
        "id": "trade_secret",
        "label": "영업비밀",
        "category": "confidential",
        "severity": "high",
        "action": "block",
        "token": "SECRET_DOC",
        "enabled": true
      },
      {
        "id": "sensitive_personal",
        "label": "민감한 개인정보",
        "category": "sensitive_personal",
        "severity": "high",
        "action": "mask",
        "token": "SENSITIVE",
        "enabled": true
      },
      {
        "id": "third_party_record",
        "label": "제3자 원본 데이터",
        "category": "third_party",
        "severity": "high",
        "action": "block",
        "token": "RECORD",
        "enabled": true
      }
    ],
    "org_rules": null,
    "destinations": {
      "anthropic": {
        "consumer": {
          "tier": "elevated",
          "basis": "설정 ON 시 학습, 학습 ON이면 비식별 데이터 최대 5년 보관",
          "verified_at": "2026-10-31"
        },
        "enterprise": {
          "tier": "standard",
          "basis": "상업용(Team·Enterprise) 학습 안 함",
          "verified_at": "2026-10-31"
        },
        "api": {
          "tier": "standard",
          "basis": "명시적 허가 없이 학습 안 함, Covered Models는 30일 보존",
          "verified_at": "2026-10-31"
        },
        "cloud": {
          "tier": "standard",
          "basis": "제3자 플랫폼 상업 조건, 학습 안 함",
          "verified_at": "2026-10-31"
        }
      },
      "openai": {
        "consumer": {
          "tier": "elevated",
          "basis": "ChatGPT 소비자 학습 정책 확인 불가(403)",
          "verified_at": "2026-10-31"
        },
        "enterprise": {
          "tier": "standard",
          "basis": "비즈니스 데이터 기본 학습 안 함",
          "verified_at": "2026-10-31"
        },
        "api": {
          "tier": "standard",
          "basis": "opt-in 없이는 학습 안 함, 남용 모니터링 로그 최대 30일",
          "verified_at": "2026-10-31"
        }
      },
      "google": {
        "consumer": {
          "tier": "elevated",
          "basis": "Keep Activity ON 시 학습, 기본 18개월 보관, 사람 검토 대화 최대 3년",
          "verified_at": "2026-10-31"
        },
        "api_free": {
          "tier": "elevated",
          "basis": "무료 API: 제품·ML 개선에 사용, 사람 검토 가능",
          "verified_at": "2026-10-31"
        },
        "api": {
          "tier": "standard",
          "basis": "유료 API: 제품 개선에 사용 안 함(남용 감시 로그 기간 미명시, 검색·지도 그라운딩은 30일 저장·끌 수 없음)",
          "verified_at": "2026-10-31"
        },
        "cloud": {
          "tier": "standard",
          "basis": "Vertex AI: 엔터프라이즈 DPA·ZDR 경로",
          "verified_at": "2026-10-31"
        }
      },
      "meta": {
        "consumer": {
          "tier": "elevated",
          "basis": "AI 기능과의 상호작용을 학습에 사용, 계정 단위 opt-out 미확인",
          "verified_at": "2026-10-31"
        },
        "self_hosted": {
          "tier": "standard",
          "basis": "Llama 자체 호스팅(외부 전송 없음 주장은 공식 문서 근거 아님)",
          "verified_at": "2026-10-31"
        }
      },
      "xai": {
        "consumer": {
          "tier": "elevated",
          "basis": "소비자 Grok 학습 정책 확인 불가",
          "verified_at": "2026-10-31"
        },
        "enterprise": {
          "tier": "standard",
          "basis": "API 입출력 학습 안 함, 요청·응답 30일 감사 저장",
          "verified_at": "2026-10-31"
        },
        "api": {
          "tier": "standard",
          "basis": "API 입출력 학습 안 함",
          "verified_at": "2026-10-31"
        }
      },
      "deepseek": {
        "consumer": {
          "tier": "restricted",
          "basis": "PRC 처리·저장 명시([충돌]), 비식별 후 개선에 사용, 고정 보관 기간 없음",
          "verified_at": "2026-10-31"
        },
        "api": {
          "tier": "restricted",
          "basis": "PRC 처리·저장 명시([충돌]), 계정 존속 기간 보관",
          "verified_at": "2026-10-31"
        }
      },
      "moonshot": {
        "consumer": {
          "tier": "restricted",
          "basis": "학습·최적화를 처리 목적으로 명시, 서버 위치 [충돌]",
          "verified_at": "2026-10-31"
        },
        "api": {
          "tier": "restricted",
          "basis": "학습 사용 여부·서버 위치가 문서 간 [충돌]",
          "verified_at": "2026-10-31"
        }
      },
      "mistral": {
        "consumer": {
          "tier": "elevated",
          "basis": "Vibe(구 Le Chat) 입출력 기본 학습(opt-out 가능), 삭제 전까지 보관",
          "verified_at": "2026-10-31"
        },
        "enterprise": {
          "tier": "standard",
          "basis": "Vibe Enterprise 기본 opt-out",
          "verified_at": "2026-10-31"
        },
        "api": {
          "tier": "elevated",
          "basis": "기본 학습 안 함(Commercial Terms 4.2)이나 기본 opt-in 제품·Studio Free·Labs 모델 예외, Pay-as-you-go 기본값 미명시, 30일 롤링 보관",
          "verified_at": "2026-10-31"
        }
      },
      "cohere": {
        "api": {
          "tier": "elevated",
          "basis": "SaaS 30일 보관, 학습 기본값 미확인",
          "verified_at": "2026-10-31"
        },
        "enterprise": {
          "tier": "standard",
          "basis": "엔터프라이즈 계약·DPA가 규율",
          "verified_at": "2026-10-31"
        }
      },
      "amazon": {
        "cloud": {
          "tier": "standard",
          "basis": "Bedrock 입출력을 학습에 쓰지 않고 모델 제공사와 공유 안 함",
          "verified_at": "2026-10-31"
        }
      },
      "perplexity": {
        "consumer": {
          "tier": "elevated",
          "basis": "소비자 플랜 학습 정책 확인 불가",
          "verified_at": "2026-10-31"
        },
        "enterprise": {
          "tier": "standard",
          "basis": "엔터프라이즈 데이터 학습·파인튜닝 안 함",
          "verified_at": "2026-10-31"
        },
        "api": {
          "tier": "standard",
          "basis": "API 약관상 Customer Content 학습 안 함(제품별 약관에 따라 다를 수 있음)",
          "verified_at": "2026-10-31"
        }
      },
      "microsoft": {
        "consumer": {
          "tier": "elevated",
          "basis": "개인 계정 학습 opt-out 방식, 대화 18개월 보관",
          "verified_at": "2026-10-31"
        },
        "enterprise": {
          "tier": "standard",
          "basis": "테넌트 관리자 opt-in 없으면 학습 안 함",
          "verified_at": "2026-10-31"
        }
      },
      "alibaba": {
        "consumer": {
          "tier": "elevated",
          "basis": "Qwen Chat: 비식별 콘텐츠를 학습에 사용 가능",
          "verified_at": "2026-10-31"
        },
        "api": {
          "tier": "standard",
          "basis": "Model Studio: 학습 안 함, 최대 30일 보관",
          "verified_at": "2026-10-31"
        },
        "self_hosted": {
          "tier": "standard",
          "basis": "Qwen 가중치 자체 호스팅",
          "verified_at": "2026-10-31"
        }
      }
    }
  }
};
