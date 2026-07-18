#include <cstdint>
#include <cstdio>
#include <cstring>

/*
 * Deliberately benign, locally compiled input for the offline radare2 MCP
 * canary. The canary analyzes this file but never executes it in the MCP
 * container. Stable exported symbols, a C++ class, and strings let every
 * read-only inspection tool receive attributable local input.
 */

extern "C" {

const char CHILLSPWN_BINARY_CANARY_MARKER[] =
    "CHILLSPWN_V2_LOCAL_BINARY_ANALYSIS_CANARY";

volatile std::uint32_t chillspwn_canary_counter = 7U;

__attribute__((noinline, used, visibility("default")))
int chillspwn_canary_add(int left, int right) {
    chillspwn_canary_counter += 1U;
    return left + right + static_cast<int>(chillspwn_canary_counter & 1U);
}

__attribute__((noinline, used, visibility("default")))
int chillspwn_canary_measure(const char *value) {
    if (value == nullptr) {
        return -1;
    }
    return static_cast<int>(std::strlen(value));
}

}

class __attribute__((visibility("default"))) ChillsPwnCanary {
 public:
    explicit ChillsPwnCanary(int seed) : seed_(seed) {}
    virtual ~ChillsPwnCanary() = default;

    __attribute__((noinline, used))
    virtual int transform(int value) const {
        return chillspwn_canary_add(seed_, value);
    }

 private:
    int seed_;
};

int main() {
    ChillsPwnCanary canary(35);
    const int measured = chillspwn_canary_measure(
        CHILLSPWN_BINARY_CANARY_MARKER);
    const int total = canary.transform(measured);
    std::printf("binary-analysis-canary:%d\n", total);
    return total == 0 ? 1 : 0;
}
